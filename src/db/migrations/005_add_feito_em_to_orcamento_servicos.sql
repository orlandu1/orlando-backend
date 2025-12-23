-- Adiciona timestamp de quando o serviço foi marcado como feito

DO $$
BEGIN
	ALTER TABLE orcamento_servicos
		ADD COLUMN feito_em TIMESTAMPTZ;
EXCEPTION
	WHEN duplicate_column THEN
		NULL;
END $$;

CREATE INDEX IF NOT EXISTS orcamento_servicos_feito_em_idx
	ON orcamento_servicos (feito_em);
