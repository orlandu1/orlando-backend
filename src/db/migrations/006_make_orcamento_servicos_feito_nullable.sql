-- Permite estado neutro para a coluna `feito` (NULL) e remove default.
-- Necessário para o botão de "reset" do admin voltar ao estado neutro.

DO $$
BEGIN
	-- só aplica se a tabela existir
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public'
			AND table_name = 'orcamento_servicos'
	) THEN
		-- torna a coluna nullable
		BEGIN
			ALTER TABLE orcamento_servicos
				ALTER COLUMN feito DROP NOT NULL;
		EXCEPTION WHEN undefined_column THEN
			NULL;
		END;

		-- remove default (para permitir "neutro" por padrão se desejado)
		BEGIN
			ALTER TABLE orcamento_servicos
				ALTER COLUMN feito DROP DEFAULT;
		EXCEPTION WHEN undefined_column THEN
			NULL;
		END;
	END IF;
END $$;
