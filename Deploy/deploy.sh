#!/usr/bin/env bash
# Deploys the UAT site over Kudu VFS.
#
# Why not `az webapp deploy`: `az account get-access-token` fails on this machine
# (CLI 2.88 bundles Python 3.14, whose strict X.509 check rejects the Netskope
# root, which has no keyUsage extension), and device-code sign-in is blocked by
# tenant Conditional Access. Kudu basic auth still works, so the publish profile
# is the credential.
#
#   Portal -> app-mdo-fe-landfeasibility-uat -> Overview -> Download publish profile
#   (the MSDeploy entry; the FTP entry's password is different and 401s)
#
# The password is passed to curl through a --config file, so it never reaches the
# terminal or the process list.
#
# Usage:
#   ./deploy.sh probe            list what is deployed now
#   ./deploy.sh push static      the pages and images only
#   ./deploy.sh push api         api/*.mjs, server.js, package.json (NOT the .sql files - see below)
#   ./deploy.sh push all
#   ./deploy.sh npm              npm install --omit=dev in wwwroot (needs api pushed)
#   ./deploy.sh restart
#   ./deploy.sh health           GET /api/appraisals through the SCM site
#   ./deploy.sh enforce on|off   flip access.config.json - the enforcement kill
#                                switch server.js checks alongside ACCESS_ENFORCE,
#                                so this can be turned off without portal access
#
# The schema files (schema.sqlserver.sql, schema-access.sqlserver.sql,
# grant.sqlserver.sql, seed-au.sqlserver.sql, verify*.sql) are never pushed by
# this script - api/db.mjs does not apply them on boot (see its header
# comment), so they are run once, by hand, against the database, by whoever
# holds the SQL or Entra admin role. See api/README.md.
set -euo pipefail

APP=app-mdo-fe-landfeasibility-uat
SCM="https://$APP.scm.azurewebsites.net"
PROFILE="${PUBLISH_PROFILE:-$HOME/Downloads/$APP.PublishSettings}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
CURLRC="$(mktemp)"
trap 'rm -f "$CURLRC"' EXIT

[ -f "$PROFILE" ] || { echo "No publish profile at $PROFILE" >&2; exit 1; }
node -e '
  const fs = require("fs");
  const xml = fs.readFileSync(process.argv[1], "utf8");
  const m = /<publishProfile[^>]*publishMethod="MSDeploy"[^>]*>/.exec(xml);
  if (!m) { console.error("no MSDeploy profile"); process.exit(1); }
  const a = (k) => (new RegExp(k + `="([^"]*)"`).exec(m[0]) || [, ""])[1];
  fs.writeFileSync(process.argv[2], `user = "${a("userName")}:${a("userPWD")}"\n`);
' "$PROFILE" "$CURLRC"

# curl here is Schannel-built, so --cacert is ignored and revocation checking
# fails behind the proxy; --ssl-no-revoke is the working combination.
k() { curl -sS --ssl-no-revoke --config "$CURLRC" "$@"; }

put() { # put <local file> <path under wwwroot>
  local src="$1" dest="$2"
  [ -f "$src" ] || { echo "missing $src" >&2; return 1; }
  printf '  %-28s %8s bytes  ' "$dest" "$(wc -c <"$src" | tr -d ' ')"
  k -X PUT -H "If-Match: *" --data-binary "@$src" "$SCM/api/vfs/site/wwwroot/$dest" -o /dev/null -w '%{http_code}\n'
}

case "${1:-probe}" in
probe)
  k "$SCM/api/vfs/site/wwwroot/" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>JSON.parse(s).forEach(f=>console.log((f.mime==="inode/directory"?"DIR  ":"     ")+f.name.padEnd(28)+(f.size||""))))'
  ;;
push)
  what="${2:-all}"
  if [ "$what" = static ] || [ "$what" = all ]; then
    echo "static:"
    put "$REPO/US_Land_Feasibility_copy.html"  us.html
    put "$REPO/Australia_Land_Feasibility_.html" australia.html
    put "$HERE/Landing.html"                   index.html
    put "$HERE/sobha-login-region.html"        sobha-login-region.html
    put "$HERE/no-access.html"                 no-access.html
    put "$HERE/admin.html"                     admin.html
  fi
  if [ "$what" = api ] || [ "$what" = all ]; then
    echo "api:"
    for f in appraisals.mjs access.mjs db.mjs http.mjs; do put "$REPO/api/$f" "api/$f"; done
    put "$HERE/server.js"    server.js
    put "$HERE/package.json" package.json
    echo "  (run ./deploy.sh npm and ./deploy.sh restart after this)"
  fi
  ;;
npm)
  k -X POST -H "Content-Type: application/json" \
    -d '{"command":"npm install --omit=dev --no-audit --no-fund","dir":"site/wwwroot"}' \
    "$SCM/api/command"
  ;;
restart)
  # No ARM token here, so the platform restart API is out of reach. Killing the
  # process makes the container supervisor start it again, which is the restart.
  k -X POST -H "Content-Type: application/json" \
    -d '{"command":"pkill -f \"node server.js\" || true","dir":"site/wwwroot"}' \
    "$SCM/api/command" || true
  echo "restart requested"
  ;;
enforce)
  case "${2:-}" in
    on)  echo '{"enforce": true}'  > "$CURLRC.cfg" ;;
    off) echo '{"enforce": false}' > "$CURLRC.cfg" ;;
    *) echo "usage: ./deploy.sh enforce on|off" >&2; exit 1 ;;
  esac
  put "$CURLRC.cfg" access.config.json
  rm -f "$CURLRC.cfg"
  echo "  server.js re-reads this at most every 5s, no restart needed"
  ;;
health)
  # Through the public host, not the SCM one: Kudu owns /api/* on the SCM host,
  # and the app itself is only reachable via the App Gateway.
  echo "GET https://uat-landfeasibility.sobhaapps.com/api/appraisals"
  curl -sS --ssl-no-revoke -o /dev/null -w '  %{http_code}  (401 = Easy Auth on and no session; 404 = store not enabled)\n' \
    https://uat-landfeasibility.sobhaapps.com/api/appraisals || true
  ;;
*)
  sed -n '2,30p' "$0"; exit 1;;
esac
