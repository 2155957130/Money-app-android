$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskAvdRoot = Join-Path $taskRoot 'build\avd'
$taskAvd = Join-Path $taskAvdRoot 'ZhangbenQA.avd'
$taskAndroidHome = Join-Path $taskRoot 'build\android-home'
$taskSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
New-Item -ItemType Directory -Force -Path $taskAvd,$taskAndroidHome | Out-Null
@"
avd.ini.encoding=UTF-8
path=$taskAvd
target=android-36
"@ | Set-Content -LiteralPath (Join-Path $taskAvdRoot 'ZhangbenQA.ini') -Encoding utf8
@"
AvdId=ZhangbenQA
avd.ini.displayname=Zhangben QA
avd.ini.encoding=UTF-8
abi.type=x86_64
hw.cpu.arch=x86_64
hw.cpu.ncore=2
hw.ramSize=2048
hw.lcd.width=1080
hw.lcd.height=2340
hw.lcd.density=420
hw.keyboard=yes
hw.gpu.enabled=yes
hw.gpu.mode=swiftshader_indirect
hw.mainKeys=no
disk.dataPartition.size=2G
image.sysdir.1=$taskSdk\system-images\android-36\google_apis_playstore\x86_64\
tag.id=google_apis_playstore
tag.display=Google Play
PlayStore.enabled=true
showDeviceFrame=no
fastboot.forceColdBoot=yes
"@ | Set-Content -LiteralPath (Join-Path $taskAvd 'config.ini') -Encoding utf8
$env:ANDROID_AVD_HOME = $taskAvdRoot
$env:ANDROID_USER_HOME = $taskAndroidHome
$env:ANDROID_EMULATOR_HOME = $taskAndroidHome
$env:ANDROID_ADB_SERVER_PORT = '5038'
$taskEmulator = Join-Path $taskSdk 'emulator\emulator.exe'
$taskProcess = Start-Process -FilePath $taskEmulator -ArgumentList @('-avd','ZhangbenQA','-port','5580','-no-window','-no-audio','-no-snapshot','-no-boot-anim','-gpu','swiftshader_indirect','-no-metrics') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskRoot 'build\emulator.stdout.log') -RedirectStandardError (Join-Path $taskRoot 'build\emulator.stderr.log')
Write-Output "Emulator PID: $($taskProcess.Id)"
