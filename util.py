#%%
import os
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import Json
from time import perf_counter as timer
import gzip

load_dotenv()
_DB_URI = os.getenv('DB_URI')
_con = psycopg2.connect(_DB_URI)

#%%

def parse_gtf_attr(s):
    """Parse a GTF attributes field into a dict"""

    d = {}
    for item in s.split(';')[:-1]:
        item = item.strip().split(' ', maxsplit=1)
        if item[0] in d:
            d[item[0]].append(item[1].strip('"'))
        else:
            d[item[0]] = [item[1].strip('"')]
    multi = ('tag', 'ccdsid', 'ont')
    return {k: v if k in multi else v[0] for k,v in d.items()}

def parse_gtf_line(line):
    """Parse a GTF line into a dict"""

    line = line.rstrip()
    cols = line.split('\t')
    feature = {
        'chromosome': cols[0],
        'source': cols[1],
        'feature_type': cols[2],
        'start': int(cols[3]),
        'end': int(cols[4]),
        'score': cols[5],
        'strand': cols[6],
        'frame': cols[7],
        'attributes': parse_gtf_attr(cols[8])
    }
    return feature

def parse_gtf(f):
    """Parse a GTF file"""

    for line in f:
        if line[0] == '#':
            continue
        yield parse_gtf_line(line)

def get_all_genes(cur):
    """Memory store of gene name/chrom combinations already in db"""

    cur.execute('SELECT id, name, chromosome, strand FROM gene;')
    return {(name, chrom, strand): gene_id for (gene_id, name, chrom, strand) in cur}

def dataset_exists(name, cur):
    cur.execute('SELECT * FROM dataset WHERE name=%s;', (name,))
    return bool(cur.fetchone())

def insert_dataset(name, cur, is_ref=False):
    cur.execute('''
        INSERT INTO dataset (name, is_reference)
        VALUES (%s, %s)
        RETURNING id;
        ''',
        (name, is_ref))
    dataset_id = cur.fetchone()[0]
    return dataset_id

def insert_gene(feat, dataset_id, cur):
    feat['attributes']['dataset_id'] = dataset_id
    cur.execute('''
        INSERT INTO gene (
            name,
            chromosome,
            strand,
            attributes)
        VALUES (%s, %s, %s, %s)
        RETURNING id;
        ''', (
            feat['attributes']['gene_name'],
            feat['chromosome'],
            feat['strand'],
            Json([feat['attributes']])
        ))
    gene_id = cur.fetchone()[0]
    return gene_id

def update_gene(gene_id, feat, dataset_id, cur):
    """Append attributes of a gene GTF line to an existing gene record in db"""

    feat['attributes']['dataset_id'] = dataset_id
    cur.execute('''
        UPDATE gene
        SET attributes = attributes || %s
        WHERE id=%s;
    ''', (
        Json([feat['attributes']]),
        gene_id
    ))

def insert_transcript(feat, gene_id, dataset_id, cur, is_model=False):
    source = feat.get('source')
    if source:
        feat['attributes']['source'] = source
    cur.execute('''
        INSERT INTO transcript (
            gene_id,
            dataset_id,
            annot_gene_id,
            annot_transcript_id,
            chrom_start,
            chrom_end,
            is_model,
            attributes)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id;
        ''', (
            gene_id,
            dataset_id,
            feat['attributes'].get('gene_id'),
            feat['attributes'].get('transcript_id'),
            feat['start'],
            feat['end'],
            is_model,
            Json(feat['attributes'])
        ))
    transcript_id = cur.fetchone()[0]
    return transcript_id

def insert_exon(feat, transcript_id, cur):
    source = feat.get('source')
    if source:
        feat['attributes']['source'] = source
    cur.execute('''
        INSERT INTO exon (
            transcript_id,
            annot_exon_id,
            exon_number,
            chrom_start,
            chrom_end,
            attributes)
        VALUES (%s, %s, %s, %s, %s, %s);
        ''', (
            transcript_id,
            feat['attributes'].get('exon_id'),
            feat['attributes']['exon_number'],
            feat['start'],
            feat['end'],
            Json(feat['attributes'])
        ))

def import_gtf(f, name, is_ref=False):
    tic = timer()
    cur = _con.cursor()
    all_genes = get_all_genes(cur)
    parse_count  = {'gene': 0, 'tx': 0, 'ex': 0}
    insert_count = {'gene': 0, 'tx': 0, 'ex': 0}
    if dataset_exists(name, cur):
        print('Dataset with that name already exists')
        return
    dataset_id = insert_dataset(name, cur, is_ref)
    skip_gene = False

    for feat in parse_gtf(f):
        if feat['feature_type'] == 'gene':
            parse_count['gene'] += 1
            skip_gene = False
            gene_tuple = (feat['attributes']['gene_name'], feat['chromosome'], feat['strand'])
            gene_id = all_genes.get(gene_tuple)
            if gene_id:
                update_gene(gene_id, feat, dataset_id, cur)
            else:
                if is_ref:
                    skip_gene = True
                    continue
                gene_id = insert_gene(feat, dataset_id, cur)
                all_genes[gene_tuple] = gene_id
                insert_count['gene'] += 1                

        elif feat['feature_type'] == 'transcript':
            parse_count['tx'] += 1
            if skip_gene:
                continue
            transcript_id = insert_transcript(feat, gene_id, dataset_id, cur)
            insert_count['tx'] += 1

        elif feat['feature_type'] == 'exon':
            parse_count['ex'] += 1
            if skip_gene:
                continue
            insert_exon(feat, transcript_id, cur)
            insert_count['ex'] += 1

    cur.close()
    _con.commit()
    toc = timer()
    print(f"parsed\n\t{parse_count['gene']} genes\n\t{parse_count['tx']} transcripts\n\t{parse_count['ex']} exons")
    print(f"inserted\n\t{insert_count['gene']} genes\n\t{insert_count['tx']} transcripts\n\t{insert_count['ex']} exons")
    print(f"in {toc-tic} seconds")
# %%
def interval_union(intervals):
    """
    Returns the union of all intervals in the input list
      intervals: list of tuples or 2-element lists
    """
    intervals.sort(key=lambda x: x[0])
    union = [intervals[0]]
    for i in intervals[1:]:
        if i[0] <= union[-1][1]:  # overlap w/ previous
            if i[1] > union[-1][1]:  # only extend if larger
                union[-1] = (union[-1][0], i[1])
        else:
            union.append(i)
    return union

def generate_model_exons():
    tic = timer()
    cur = _con.cursor()
    genes = get_all_genes(cur)
    gene_count = 0
    ex_count = 0

    # delete old model exons/transcript if they exist
    cur.execute('''
        DELETE FROM exon
        WHERE transcript_id IN (
            SELECT id
            FROM transcript
            WHERE is_model=true
        );
        ''')
    cur.execute('''
        DELETE FROM transcript WHERE is_model=true;
        ''',)

    for (gene_name, chrom, strand), gene_id in genes.items():
        cur.execute('''
            SELECT chrom_start, chrom_end
            FROM exon
            WHERE transcript_id IN (
                SELECT id
                FROM transcript
                WHERE gene_id=%s AND is_model=false
            );
            ''',
            (gene_id,))
        exon_coords = cur.fetchall()
        new_coords = interval_union(exon_coords)
        start_pos = min(i[0] for i in new_coords)
        end_pos = max(i[1] for i in new_coords)
        if strand == '-':
            new_coords.reverse()
                
        # insert transcript
        transcript_id = insert_transcript({
            'start': start_pos,
            'end': end_pos,
            'attributes': {}
            }, gene_id, None, cur, is_model=True)
        
        # insert exons
        for i, (start, end) in enumerate(new_coords, 1):
            insert_exon({
                'start': start,
                'end': end,
                'attributes': {'exon_number': i}
            }, transcript_id, cur)
            ex_count += 1
        
        gene_count += 1

    _con.commit()
    cur.close()
    toc = timer()
    print(f'generated\n\t{ex_count} exons\nacross\n\t{gene_count} genes')
    print(f'in {toc-tic} seconds')

#%%

def import_expression_values(f, dataset):
    tic = timer()
    tx = {}
    for i,line in enumerate(f):
        if i == 0:
            continue
        tokens = line.split()
        tx_id = tokens[3].replace('-', '_')
        cell_type = tokens[4]
        avg_exp = float(tokens[1])
        pct_exp = float(tokens[2])
        avg_exp_scaled = float(tokens[5])
        if tx_id not in tx:
            tx[tx_id] = {}
        tx[tx_id][cell_type] = [avg_exp, pct_exp, avg_exp_scaled]
    print(f'read\n\t{len(tx)} transcripts')

    write_count = 0
    cur = _con.cursor()
    cur.execute('SELECT id FROM dataset WHERE name=%s', (dataset,))
    dataset_id = cur.fetchone()[0]
    for tx_id in tx:
        exp = [dict(zip(['cell_type', 'avg_exp', 'pct_exp', 'avg_exp_scaled'], [k]+v)) for k,v in tx[tx_id].items()]
        cur.execute('''
            UPDATE transcript
            SET attributes = attributes || %s
            WHERE annot_transcript_id=%s AND dataset_id=%s
            ''', (
                Json({'expression': exp}),
                tx_id,
                dataset_id
            ))
        write_count += cur.rowcount
    _con.commit()
    cur.close()
    toc = timer()
    print(f'updated\n\t{write_count} transcripts')
    print(f'in {toc-tic} seconds')

#%%

def init_db(fname='schema.sql'):
    with open(fname) as f:
        schema = f.read()
    cur = _con.cursor()
    cur.execute(schema)
    _con.commit()
    cur.close()

def populate_db(data_dir='data'):
    with open(f'{data_dir}/Isoform_annotations_4281_knownCells.gtf') as f:
        import_gtf(f, 'final')

    with gzip.open(f'{data_dir}/gencode.v33lift37.annotation.gtf.gz', 'rt') as f:
        import_gtf(f, 'gencode.v33lift37', is_ref=True)

    generate_model_exons()

    with open(f'{data_dir}/Isoform_Average_percent_expression_updated.txt') as f:
        import_expression_values(f, 'final')

#%%

if __name__ == "__main__":
    init_db()
    populate_db(data_dir='../data')
