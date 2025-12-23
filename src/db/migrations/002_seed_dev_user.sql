-- Seed inicial para conseguir testar login sem UI de cadastro
-- Usuario: dev
-- Senha: opera@320

-- Hash bcrypt (cost=10) para 'opera@320'

INSERT INTO users (username, email, role, name, password_hash)
VALUES ('dev', 'dev@local', 0, 'Dev', '$2a$10$oFz0etOd0T2b8QxiKI6bnujb585Zg8Gnsq1B7mYq8ph6WmeNpBAHW')
ON CONFLICT DO NOTHING;
