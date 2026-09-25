-- EJE Project Tracker — database creation.
--
-- LEAST PRIVILEGE, AND A DATABASE OF ITS OWN. The tracker's role owns its own
-- database and has no rights anywhere else on the cluster — in particular none
-- at all on the EJE application's database. Run this as a superuser ONCE, on
-- the VPS, by hand:
--
--     sudo -u postgres psql -v tracker_password="'<a generated password>'" \
--          -f deploy/database.sql
--
-- The password is supplied on the command line at run time and is never stored
-- in this file, in Git, or in any document.

\set ON_ERROR_STOP on

CREATE ROLE eje_tracker_app LOGIN PASSWORD :tracker_password;
CREATE DATABASE eje_tracker OWNER eje_tracker_app;

-- Nothing else on this cluster is the tracker's business.
REVOKE ALL ON DATABASE eje_tracker FROM PUBLIC;
GRANT CONNECT ON DATABASE eje_tracker TO eje_tracker_app;

\connect eje_tracker

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO eje_tracker_app;

-- The schema itself is created by the migrations, not here:
--     cd /srv/eje-tracker/app && npm run migrate
