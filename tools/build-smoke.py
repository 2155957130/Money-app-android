from pathlib import Path
import zipfile
import os
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import build as b

src=b.ROOT/'tests/android'
target=b.BUILD/'smoke'
for p in [target/'generated',target/'classes',target/'dex']:
    p.mkdir(parents=True,exist_ok=True)
b.run([b.RESOURCES/'aapt.exe','package','-f','-m','-J',target/'generated','-M',src/'AndroidManifest.xml','-A',src/'assets','-I',b.ANDROID,'-F',target/'resources.apk'])
b.run([b.JDK/'bin/javac.exe','-encoding','UTF-8','-source','8','-target','8','-classpath',str(b.ANDROID)+os.pathsep+str(b.BUILD/'classes'),'-d',target/'classes',*sorted(src.glob('*.java'))])
with zipfile.ZipFile(target/'classes.jar','w',zipfile.ZIP_DEFLATED) as jar:
    for f in (target/'classes').rglob('*.class'):jar.write(f,f.relative_to(target/'classes').as_posix())
b.run([b.JDK/'bin/java.exe','-cp',b.TOOLS/'lib/d8.jar','com.android.tools.r8.D8','--min-api','26','--lib',b.DEX_LIBRARY,'--output',target/'dex',target/'classes.jar'])
(target/'unsigned.apk').write_bytes((target/'resources.apk').read_bytes())
with zipfile.ZipFile(target/'unsigned.apk','a',zipfile.ZIP_DEFLATED) as apk:apk.write(target/'dex/classes.dex','classes.dex')
b.run([b.TOOLS/'zipalign.exe','-f','4',target/'unsigned.apk',target/'aligned.apk'])
env=dict(os.environ,ZHANGBEN_KEY_PASSWORD=(b.SIGNING/'keystore-password.txt').read_text(encoding='utf-8').strip())
b.run([b.JDK/'bin/java.exe','-jar',b.TOOLS/'lib/apksigner.jar','sign','--ks',b.SIGNING/'zhangben-release.jks','--ks-key-alias','zhangben','--ks-pass','env:ZHANGBEN_KEY_PASSWORD','--key-pass','env:ZHANGBEN_KEY_PASSWORD','--out',target/'native-smoke.apk',target/'aligned.apk'],env=env)
print('Built native instrumentation APK in build/smoke (not part of the app distribution).')
