-- Tabelas para suportar a tela de Orçamentos (serviços e pagamentos)

-- Serviços solicitados
CREATE TABLE IF NOT EXISTS orcamento_servicos (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	codigo text NOT NULL,
	servico text NOT NULL,
	custo numeric(12,2) NOT NULL,
	aprovacao text NOT NULL DEFAULT 'pendente' CHECK (aprovacao IN ('aprovado','negado','pendente')),
	aprovado_em timestamptz,
	feito boolean NOT NULL DEFAULT false,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT orcamento_servicos_user_codigo_uk UNIQUE (user_id, codigo)
);

CREATE INDEX IF NOT EXISTS orcamento_servicos_user_id_idx ON orcamento_servicos(user_id);
CREATE INDEX IF NOT EXISTS orcamento_servicos_user_aprovacao_idx ON orcamento_servicos(user_id, aprovacao);

-- Pagamentos (extrato)
CREATE TABLE IF NOT EXISTS orcamento_pagamentos (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	codigo text NOT NULL,
	data date NOT NULL,
	valor numeric(12,2) NOT NULL,
	comprovante_nome text,
	comprovante_tipo text,
	comprovante_tamanho integer,
	comprovante_data_url text,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT orcamento_pagamentos_user_codigo_uk UNIQUE (user_id, codigo)
);

CREATE INDEX IF NOT EXISTS orcamento_pagamentos_user_id_idx ON orcamento_pagamentos(user_id);
CREATE INDEX IF NOT EXISTS orcamento_pagamentos_user_data_idx ON orcamento_pagamentos(user_id, data DESC);
