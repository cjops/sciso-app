BEGIN;

CREATE TYPE genomic_strand AS ENUM ('+', '-');

--ALTER SYSTEM SET wal_level = replica;

CREATE TABLE gene
(
    id integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
    name text NOT NULL,
    chromosome text NOT NULL,
    strand genomic_strand NOT NULL,
    attributes jsonb,
    UNIQUE (name, chromosome)
);

CREATE TABLE dataset
(
    id integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
    name text UNIQUE NOT NULL,
    created_on date DEFAULT current_date NOT NULL,
    is_reference boolean DEFAULT false NOT NULL --T if from GENCODE, F if from TALON
);

CREATE TABLE transcript
(
    id integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
    gene_id integer REFERENCES gene NOT NULL,
    dataset_id integer REFERENCES dataset,
    annot_gene_id text,
    annot_transcript_id text,
    chrom_start integer NOT NULL,
    chrom_end integer NOT NULL,
    is_model boolean DEFAULT false NOT NULL,
    attributes jsonb
);

CREATE TABLE exon
(
    id integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
    transcript_id integer REFERENCES transcript,
    annot_exon_id text,
    exon_number integer NOT NULL,
    chrom_start integer NOT NULL,
    chrom_end integer NOT NULL,
    attributes jsonb
);

--populate db

--ALTER SYSTEM RESET wal_level;

CREATE INDEX ON exon (transcript_id) INCLUDE (chrom_start, chrom_end);
CREATE INDEX ON transcript (gene_id, is_model);
CREATE UNIQUE INDEX ON transcript (gene_id, is_model) WHERE is_model; --only one model allowed
CREATE INDEX ON transcript (annot_transcript_id, dataset_id);
--more to come

END;