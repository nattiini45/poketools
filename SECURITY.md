# Security policy

## Reporting a vulnerability

Please do not report security vulnerabilities in public issues, pull requests or discussions.

Report them privately through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. The report reaches the maintainers only.

Please include:

- what is affected (route, component, migration or script) and on which commit;
- steps to reproduce, or a proof of concept;
- the impact you expect (for example data exposure, privilege escalation or denial of service).

Do not include real user data, credentials or tokens in the report. Test only against your own deployment or a local stack (`npx supabase start`), never against someone else's instance.

## What to expect

This is a volunteer-maintained project. We aim to acknowledge a report within 7 days and to agree a disclosure date with you once a fix is ready. We will credit you in the advisory unless you ask us not to.

## Supported versions

Only the latest commit on `main` receives security fixes. Self-hosted deployments are responsible for updating to it.

## Scope

In scope: the code in this repository, including API routes, auth guards, Supabase migrations (grants and RLS) and CI workflows.

Out of scope: vulnerabilities in third-party services (Supabase, Vercel, Discord, AI providers) or in dependencies, unless this project uses them insecurely. Report those to the vendor. Misconfiguration of an individual self-hosted deployment is also out of scope.
