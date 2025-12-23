-- Garante que o codigo seja único globalmente (admin e cliente operam no mesmo dataset)

DO $$
BEGIN
	ALTER TABLE orcamento_servicos
		ADD CONSTRAINT orcamento_servicos_codigo_uk UNIQUE (codigo);
EXCEPTION
	WHEN duplicate_object THEN
		NULL;
END $$;

DO $$
BEGIN
	ALTER TABLE orcamento_pagamentos
		ADD CONSTRAINT orcamento_pagamentos_codigo_uk UNIQUE (codigo);
EXCEPTION
	WHEN duplicate_object THEN
		NULL;
END $$;
