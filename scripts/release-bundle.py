#!/usr/bin/env python3
"""Offline complete-source candidate packaging. Verification is not deployment approval."""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tarfile, tempfile
from pathlib import Path

EXCLUDED = {'node_modules','.git','.next','dist','out','coverage','backups','.claude','.codex','.zcode','.workbuddy','__pycache__'}
SECRET_SUFFIXES = ('.db','.db-wal','.db-shm','.db-journal','.sqlite','.sqlite3','.pem','.key','.bak','.log','.tsbuildinfo','.tar.gz','.zip')
ROOT_NAMES = {'Dockerfile','start.sh','.dockerignore','.gitignore','next-env.d.ts'}
SOURCE_DIRS = {'src','server','scripts','public'}

def inventory(root):
    files=[]
    for p in sorted(root.rglob('*')):
        rel=p.relative_to(root)
        if any(part in EXCLUDED for part in rel.parts): continue
        if rel.parts[0] in {'uploads','files'} or rel.parts[:2] in {('server','uploads'),('public','uploads')}: continue
        if p.name.startswith(('test-results','test-report','results.','verification.')): continue
        if p.name.startswith('.env') or p.name.startswith('.oss') or p.name=='.DS_Store' or p.name.endswith(SECRET_SUFFIXES): continue
        include = rel.parts[0] in SOURCE_DIRS or len(rel.parts)==1 and (p.name in ROOT_NAMES or p.suffix in {'.json','.ts','.mjs','.cjs','.js','.sh'})
        if not include: continue
        if p.is_symlink(): raise ValueError(f'Unexpected runtime symlink: {rel}')
        if p.is_file(): files.append(p)
    return files

def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def entries(root):return {p.relative_to(root).as_posix():{'sha256':digest(p),'mode':p.stat().st_mode & 0o777} for p in inventory(root)}
def closure(root, project):
    missing=[]
    for p in inventory(root):
        if p.relative_to(root).parts[0] not in {'server','src'}: continue
        if p.suffix not in {'.ts','.tsx','.mts','.cts','.js','.jsx','.mjs','.cjs'}: continue
        code=p.read_text()
        for spec in re.findall(r'''(?:\bfrom\s*|\b(?:import|require)\s*\(\s*)['"]([^'"]+)['"]''',code):
            if spec.startswith('@/') and project=='internal': base=root/'src'/spec[2:]
            elif spec.startswith('.'): base=p.parent/spec
            else: continue
            base=Path(str(base).split('?')[0])
            candidates=[base]+[Path(str(base)+ext) for ext in ('.ts','.tsx','.mts','.cts','.js','.jsx','.mjs','.cjs','.json')]+[base/('index'+ext) for ext in ('.ts','.tsx','.js','.cjs','.mjs')]
            if not any(x.is_file() for x in candidates): missing.append({'source':str(p.relative_to(root)),'import':spec})
    if missing: raise ValueError('Missing relative runtime imports: '+json.dumps(missing,ensure_ascii=False))

def verify(bundle, source=None):
    manifest=json.loads((bundle/'manifest.json').read_text())
    payload=bundle/'source'
    actual=entries(payload)
    all_payload={p.relative_to(payload).as_posix() for p in payload.rglob('*') if p.is_file() or p.is_symlink()}
    if all_payload!=set(actual): raise ValueError('Unlisted/excluded file found in extracted package')
    if actual!=manifest['files']: raise ValueError('Package file inventory or hashes differ from manifest')
    if source and entries(source)!=actual: raise ValueError('Source/package difference: a runtime file is missing, changed or extra')
    closure(payload,manifest['project'])
    with tarfile.open(bundle/'source.tar.gz','r:gz') as tf:
        if any(not m.isfile() for m in tf.getmembers()): raise ValueError('Archive contains unexpected non-regular entries')
        regular={m.name:m for m in tf.getmembers() if m.isfile()}
        if set(regular)!=set('source/'+x for x in actual): raise ValueError('Archive inventory differs from extracted source')
        for rel, expected in actual.items():
            member=regular['source/'+rel]
            if hashlib.sha256(tf.extractfile(member).read()).hexdigest()!=expected['sha256'] or member.mode!=expected['mode']: raise ValueError('Archive checksum/mode mismatch: '+rel)
    return manifest

def run_checks(root, project):
    checks=[]
    commands = ([['node','node_modules/typescript/bin/tsc','--noEmit','-p','tsconfig.app.json'],['node','node_modules/typescript/bin/tsc','--noEmit','-p','tsconfig.node.json'],['node','node_modules/typescript/bin/tsc','--noEmit','--strict','-p','server/tsconfig.json'],['npm','run','build']] if project=='client' else [['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false'],['npm','run','verify'],['npm','run','build','--','--webpack']])
    # Do not inherit machine-specific DB paths or secrets, and never install dependencies.
    env={k:os.environ[k] for k in ['PATH','HOME','TMPDIR','LANG'] if k in os.environ}
    env.update({'NODE_ENV':'production','NEXT_TELEMETRY_DISABLED':'1','JWT_SECRET':'build-time-placeholder-not-used-at-runtime','NEXT_PHASE':'phase-production-build'})
    # Every check that needs SQL uses the real initializer in a fresh synthetic DB.
    # Never fall back to a source-tree or externally configured business database.
    with tempfile.TemporaryDirectory(prefix='xt-release-',dir='/tmp') as temp:
        fixture=str(Path(temp)/'fixture.db')
        env.update({'DB_PATH':fixture,'XIANGTAI_DB_PATH':fixture,'INTERNAL_SYNC_URL':'','CUSTOMER_SYNC_URL':''})
        if project=='internal': commands.insert(0,['node','scripts/create-verification-db.cjs',fixture])
        for argv in commands:
            p=subprocess.run(argv,cwd=root,env=env,text=True,capture_output=True)
            checks.append({'argv':argv,'cwd':str(root),'env':env,'stdout':p.stdout,'stderr':p.stderr,'exit_status':p.returncode})
            # A failed mandatory gate already blocks release; do not start unrelated build/network fetches.
            if p.returncode: break
    return checks

def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='action',required=True)
    create=sub.add_parser('create');create.add_argument('--root',required=True,type=Path);create.add_argument('--project',required=True,choices=['client','internal']);create.add_argument('--output',required=True,type=Path);create.add_argument('--source-only',action='store_true',help='Package an explicitly unapproved source candidate; does not bypass a release gate.')
    check=sub.add_parser('verify');check.add_argument('--bundle',required=True,type=Path);check.add_argument('--against-source',type=Path)
    gate=sub.add_parser('check');gate.add_argument('--root',required=True,type=Path);gate.add_argument('--project',required=True,choices=['client','internal']);gate.add_argument('--record',required=True,type=Path)
    args=parser.parse_args()
    if args.action=='verify':
        data=verify(args.bundle.resolve(),args.against_source.resolve() if args.against_source else None);print(json.dumps({'verified':True,'project':data['project'],'files':len(data['files']),'deployment_approved':False}));return 0
    if args.action=='check':
        checks=run_checks(args.root.resolve(),args.project);args.record.parent.mkdir(parents=True,exist_ok=True);args.record.write_text(json.dumps(checks,ensure_ascii=False,indent=2));passed=all(x['exit_status']==0 for x in checks);print(json.dumps({'checks_passed':passed,'deployment_approved':False,'record':str(args.record)}));return 0 if passed else 2
    root=args.root.resolve();output=args.output.resolve()
    if root==output or root in output.parents: raise ValueError('Output must be outside source root')
    if output.exists(): raise ValueError('Output exists; choose a new candidate directory')
    closure(root,args.project);before=entries(root);output.mkdir(parents=True);payload=output/'source'
    for rel in before:
        dest=payload/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/rel,dest)
    if entries(payload)!=before or entries(root)!=before: raise ValueError('Source changed during packaging; candidate is invalid')
    checks=[] if args.source_only else run_checks(root,args.project)
    if entries(root)!=before: raise ValueError('Checks changed source; create a new candidate after reviewing generated files')
    manifest={'format':1,'project':args.project,'files':before,'checks':checks,'source_only':args.source_only,'deployment_approved':False,'note':'Full source and resources, not node_modules, secrets, databases, uploads or build artifacts. Build on the target OS/Node ABI, run startup + restore smoke, and verify source again before deployment.'}
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    with tarfile.open(output/'source.tar.gz','w:gz') as tf:
        for rel in before:tf.add(payload/rel,arcname='source/'+rel,recursive=False)
    verify(output,root);passed=not args.source_only and all(x['exit_status']==0 for x in checks)
    print(json.dumps({'candidate':str(output),'files':len(before),'source_verified':True,'static_checks_passed':passed,'deployment_approved':False}));return 0 if args.source_only or passed else 2
if __name__=='__main__':
    try:sys.exit(main())
    except Exception as error:print(str(error),file=sys.stderr);sys.exit(1)
