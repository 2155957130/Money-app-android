"""Offline Android APK build using the installed JDK and Android SDK; no Gradle downloads."""
from pathlib import Path
import os
import secrets
import subprocess
import zipfile
import hashlib
import json
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parents[1]
SDK = Path(os.environ.get('ANDROID_SDK_ROOT', Path.home() / 'AppData/Local/Android/Sdk'))
JDK = Path(os.environ.get('JAVA_HOME', 'C:/Program Files/Android/jdk/jdk-8.0.302.8-hotspot/jdk8u302-b08'))
TOOLS = SDK / 'build-tools/30.0.3'
RESOURCES = SDK / 'build-tools/35.0.1'
ANDROID = SDK / 'platforms/android-35/android.jar'
# The installed Java-8-compatible D8 reads the API-33 desugaring library.
# Compilation and resource linking still target API 35.
DEX_LIBRARY = SDK / 'platforms/android-33/android.jar'
BUILD = ROOT / 'build'
SRC = ROOT / 'app/src/main'
OUT = ROOT / 'dist'
SIGNING = ROOT / 'signing'

def run(args, **kwargs):
    print('> ' + str(args[0]) + ' ' + ' '.join(str(x) for x in args[1:3]), flush=True)
    result = subprocess.run([str(a) for a in args], cwd=ROOT, capture_output=True, **kwargs)
    raw_output = result.stdout + result.stderr
    try:
        output = raw_output.decode('utf-8')
    except UnicodeDecodeError:
        output = raw_output.decode('gb18030',errors='replace')
    with (BUILD/'build.log').open('a',encoding='utf-8') as log:
        log.write(output)
    if output: print(output[-6000:],flush=True)
    result.check_returncode()

def main():
    for p in [BUILD/'generated', BUILD/'classes', BUILD/'dex', OUT, SIGNING]:
        p.mkdir(parents=True, exist_ok=True)
    for p in [JDK/'bin/java.exe', TOOLS/'aapt.exe', ANDROID]:
        if not p.exists():
            raise SystemExit(f'Missing build dependency: {p}')
    (BUILD/'build.log').write_text('',encoding='utf-8')
    run([RESOURCES/'aapt.exe', 'package', '-f', '-m', '-J', BUILD/'generated', '-M', SRC/'AndroidManifest.xml',
         '-S', SRC/'res', '-A', SRC/'assets', '-I', ANDROID, '-F', BUILD/'resources.apk'])
    sources = sorted((SRC/'java').rglob('*.java')) + sorted((BUILD/'generated').rglob('*.java'))
    run([JDK/'bin/javac.exe', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', ANDROID,
         '-d', BUILD/'classes', *sources])
    with zipfile.ZipFile(BUILD/'classes.jar','w',zipfile.ZIP_DEFLATED) as jar:
        for f in sorted((BUILD/'classes').rglob('*.class')):
            jar.write(f,f.relative_to(BUILD/'classes').as_posix())
    run([JDK/'bin/java.exe', '-cp', TOOLS/'lib/d8.jar', 'com.android.tools.r8.D8', '--min-api', '26',
         '--lib', DEX_LIBRARY, '--output', BUILD/'dex', BUILD/'classes.jar'])
    unsigned = BUILD/'unsigned.apk'
    unsigned.write_bytes((BUILD/'resources.apk').read_bytes())
    with zipfile.ZipFile(unsigned,'a',zipfile.ZIP_DEFLATED) as apk:
        for f in sorted((BUILD/'dex').glob('*.dex')):
            apk.write(f,f.name)
    run([TOOLS/'zipalign.exe', '-f', '-p', '4', unsigned, BUILD/'aligned.apk'])
    key = SIGNING/'zhangben-release.jks'
    password = SIGNING/'keystore-password.txt'
    if key.exists() and not password.exists():
        raise SystemExit('Signing password file is missing. Restore it rather than creating a different signing key.')
    if not password.exists():
        password.write_text(secrets.token_urlsafe(32),encoding='utf-8')
    signing_env = dict(os.environ, ZHANGBEN_KEY_PASSWORD=password.read_text(encoding='utf-8').strip())
    if not key.exists():
        run([JDK/'bin/keytool.exe','-genkeypair','-keystore',key,'-storetype','JKS','-alias','zhangben',
             '-keyalg','RSA','-keysize','2048','-validity','36500','-dname','CN=Zhangben, O=Personal Ledger, C=CN',
             '-storepass:env','ZHANGBEN_KEY_PASSWORD','-keypass:env','ZHANGBEN_KEY_PASSWORD'],env=signing_env)
    package = OUT/'Money-1.8.11.apk'
    signer = [JDK/'bin/java.exe','-jar',TOOLS/'lib/apksigner.jar']
    run([*signer,'sign','--ks',key,'--ks-key-alias','zhangben','--ks-pass','env:ZHANGBEN_KEY_PASSWORD',
         '--key-pass','env:ZHANGBEN_KEY_PASSWORD','--v1-signing-enabled','true','--v2-signing-enabled','true',
         '--v3-signing-enabled','true','--out',package,BUILD/'aligned.apk'],env=signing_env)
    run([*signer,'verify','--verbose','--print-certs',package])
    run([TOOLS/'zipalign.exe','-c','-p','4',package])
    manifest = {'file':package.name,'package':'cn.zhangben.paw','version':'1.8.11','minAndroid':'8.0',
                'targetSdk':35,'bytes':package.stat().st_size,'sha256':hashlib.sha256(package.read_bytes()).hexdigest()}
    (OUT/'build-info.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(manifest,ensure_ascii=False,indent=2))

if __name__ == '__main__':
    main()
