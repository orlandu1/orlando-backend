-- Tabela de log de auditoria para rastreabilidade completa
CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID NOT NULL DEFAULT gen_random_uuid(),
    action          TEXT NOT NULL,           -- ex: 'servico.aprovado', 'servico.valor_alterado', 'servico.nome_alterado', 'servico.aprovacao_desfeita'
    entity_type     TEXT NOT NULL,           -- ex: 'servico', 'pagamento', 'projeto'
    entity_id       TEXT,                    -- codigo do serviço/pagamento ou id do projeto
    project_id      TEXT,
    actor_user_id   TEXT NOT NULL,
    actor_name      TEXT,
    actor_email     TEXT,
    actor_role      INTEGER,
    target_user_id  TEXT,                    -- dono do projeto / cliente afetado
    target_name     TEXT,
    target_email    TEXT,
    ip_address      TEXT,
    ip_location     TEXT,                    -- cidade/região aproximada via IP
    user_agent      TEXT,
    old_value       JSONB,                   -- valores anteriores
    new_value       JSONB,                   -- valores novos
    metadata        JSONB,                   -- dados adicionais (projeto nome, etc.)
    email_sent      BOOLEAN DEFAULT FALSE,
    email_error     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_project ON audit_log (project_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_log_transaction ON audit_log (transaction_id);
