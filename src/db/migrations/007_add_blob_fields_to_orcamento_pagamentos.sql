-- Suporte a comprovantes via Blob Storage (ex: Vercel Blob)
-- Armazena metadados + url/pathname no Postgres (não armazena o arquivo em si).

ALTER TABLE orcamento_pagamentos
	ADD COLUMN IF NOT EXISTS comprovante_url text,
	ADD COLUMN IF NOT EXISTS comprovante_pathname text,
	ADD COLUMN IF NOT EXISTS comprovante_uploaded_at timestamptz;

-- Backfill leve: se já existia comprovante_data_url, copia para comprovante_url
UPDATE orcamento_pagamentos
SET comprovante_url = COALESCE(comprovante_url, comprovante_data_url)
WHERE comprovante_url IS NULL
	AND comprovante_data_url IS NOT NULL;

-- Índice opcional para operações administrativas (ex: delete por pathname)
CREATE INDEX IF NOT EXISTS orcamento_pagamentos_comprovante_pathname_idx
	ON orcamento_pagamentos (comprovante_pathname);
