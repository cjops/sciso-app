import os
import psycopg2
import psycopg2.extras
from flask import Flask, request, render_template, g
from flask_cors import CORS
app = Flask(__name__, static_url_path='')
CORS(app)

DB_URI = \
    os.getenv('DB_URI_DEV') \
    if os.getenv('FLASK_ENV') == 'development' and os.getenv('DB_URI_DEV') \
    else os.getenv('DB_URI')

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = psycopg2.connect(DB_URI)
    return db

def get_datasets():
    cur = get_db().cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute('''
        SELECT *
        FROM dataset;
        ''')
    datasets = [dict(x) for x in cur.fetchall()]
    cur.close()
    return {'datasets': datasets}

def get_gene_names(datasets=['rep1', 'rep2']):
    '''
    Get a full list of gene names to be used with autocomplete.
    '''

    # Might make sense for currently visible datasets to be stored in the db
    # instead of hardcoded here.

    cur = get_db().cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute('''
        SELECT id, name
        FROM gene g
        WHERE EXISTS (
            SELECT FROM transcript
            WHERE dataset_id IN (SELECT id FROM dataset WHERE name=ANY(%s))
            AND gene_id=g.id
        );
        ''',
        (list(datasets),))
    gene_list = [(g['id'], g['name']) for g in cur]
    gene_list.sort(key=lambda x: x[1])
    return {'genes': gene_list}

def find_gene(gene_name):
    cur = get_db().cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute('''
        SELECT id, name, chromosome, strand
        FROM gene
        WHERE name=%s;
        ''',
        (gene_name,))
    gene = cur.fetchone()
    if not gene:
        return {}
    gene = dict(gene)
    cur.execute('''
        SELECT *
        FROM transcript
        WHERE gene_id=%s;
        ''',
        (gene['id'],))
    transcripts = {x['id']: dict(x) for x in cur}
    cur.execute('''
        SELECT *
        FROM exon
        WHERE transcript_id=ANY(%s);
        ''',
        (list(transcripts.keys()),))
    for x in cur:
        if 'exons' in transcripts[x['transcript_id']]:
            transcripts[x['transcript_id']]['exons'].append(dict(x))
        else:
            transcripts[x['transcript_id']]['exons'] = [dict(x)]
    gene['transcripts'] = list(transcripts.values())
    cur.close()
    return gene

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

@app.route('/')
def hello_world():
    return render_template('index.html')

@app.route("/v2/gene")
def gene_api():
    gene_name = request.args.get('geneId')
    print(gene_name)
    return find_gene(gene_name)

@app.route("/v2/dataset")
def dataset_api():
    return get_datasets()

@app.route("/v2/gene_names")
def gene_name_api():
    return get_gene_names()