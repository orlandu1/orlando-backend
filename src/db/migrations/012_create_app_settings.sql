-- Tabela para armazenar configurações gerais do app (ex: link do APK)
CREATE TABLE IF NOT EXISTS app_settings (
	key VARCHAR(100) PRIMARY KEY,
	value TEXT NOT NULL,
	description VARCHAR(255),
	updated_at TIMESTAMPTZ DEFAULT now(),
	updated_by UUID REFERENCES users(id)
);

-- Insere configuração inicial do link do APK
INSERT INTO app_settings (key, value, description)
VALUES ('apk_download_url', '', 'Link para download do APK Android')
ON CONFLICT (key) DO NOTHING;
