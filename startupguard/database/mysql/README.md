# MySQL version (archived)

StartupGuard now runs on SQLite (see `../schema.sql` and `../SCHEMA.md`). These are the MySQL 8 files from phases 2 to 4, kept unchanged in case the project moves back to MySQL:

- `schema.sql`, `seed.sql`, `SCHEMA.md`: the MySQL schema, NovaFit demo data and notes. Load with the `mysql` client.
- `config.mysql.php`, `db.mysql.php`: the old `api/config.php` and `api/db.php` (SG_DB_HOST, SG_DB_PORT, SG_DB_NAME, SG_DB_USER, SG_DB_PASS, SG_DB_CHARSET). To switch back, copy them over `api/config.php` and `api/db.php`, then add `isUniqueViolation()` and `isForeignKeyViolation()` to `db.php` checking MySQL driver codes 1062 and 1452 (`api/financials.php` calls them).
