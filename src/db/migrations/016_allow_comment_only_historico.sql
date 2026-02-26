-- Permitir comentários no histórico sem alterar o status.
-- Quando status for NULL, trata-se de uma mensagem/comentário avulso.

ALTER TABLE chamado_historico ALTER COLUMN status DROP NOT NULL;
