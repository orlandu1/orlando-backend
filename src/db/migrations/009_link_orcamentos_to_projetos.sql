-- Vínculo explícito de serviços/pagamentos com projetos

ALTER TABLE orcamento_servicos
	ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projetos(id) ON DELETE CASCADE;

ALTER TABLE orcamento_pagamentos
	ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projetos(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS orcamento_servicos_project_id_idx ON orcamento_servicos(project_id);
CREATE INDEX IF NOT EXISTS orcamento_pagamentos_project_id_idx ON orcamento_pagamentos(project_id);
