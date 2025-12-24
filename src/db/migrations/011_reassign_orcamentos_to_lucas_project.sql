-- Correção pontual: reassocia serviços/pagamentos existentes ao projeto do cliente
-- Contexto: registros foram criados enquanto um admin estava logado, então ficaram com user_id do admin.
-- Como atualmente existe apenas 1 cliente e 1 projeto (Lucas), movemos todos os registros para ele.

DO $$
DECLARE
	target_user_id uuid := 'c0746b5b-cb64-409f-80da-24ae98c2f0e3';
	target_project_id uuid := '205e3482-e2bb-4c26-a29b-640e6328c3cc';
	exists_project boolean;
BEGIN
	SELECT EXISTS(
		SELECT 1
		FROM projetos p
		WHERE p.id = target_project_id
			AND p.owner_user_id = target_user_id
	) INTO exists_project;

	IF NOT exists_project THEN
		RAISE EXCEPTION 'Projeto alvo (%) não existe ou não pertence ao usuário alvo (%)', target_project_id, target_user_id;
	END IF;

	-- Move todos os serviços
	UPDATE orcamento_servicos
	SET
		user_id = target_user_id,
		project_id = target_project_id,
		updated_at = now()
	WHERE user_id <> target_user_id OR project_id <> target_project_id;

	-- Move todos os pagamentos
	UPDATE orcamento_pagamentos
	SET
		user_id = target_user_id,
		project_id = target_project_id,
		updated_at = now()
	WHERE user_id <> target_user_id OR project_id <> target_project_id;
END $$;
