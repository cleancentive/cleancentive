SELECT 'CREATE DATABASE outline'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'outline')\gexec
