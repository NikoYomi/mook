; ============================================================================
; Mook —— Windows 安装程序（Inno Setup 6）
;
; 由 CI 调用（版本号与路径全部通过 /D 传入，脚本内不写死）：
;   ISCC.exe /DAppVersion=0.3.0 /DSourceDir=<staging> /DOutputDir=<out> \
;            /DOutputBase=mook-v0.3.0-windows-x64 /DIconFile=<abs>\mook.ico \
;            /DUseZh=1 packaging\windows\mook.iss
;
; 约定：本文件只使用 ASCII 字符。
;   .iss 在不同 Inno Setup 版本下对非 ASCII 源文件编码的容忍度不一致，
;   所以向导界面文案一律交给官方语言包（Languages\ChineseSimplified.isl），
;   脚本自身保持纯 ASCII 以免踩编码坑。
; ============================================================================

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\build\winpkg"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\build\out"
#endif
#ifndef OutputBase
  #define OutputBase "mook-windows-x64"
#endif
#ifndef IconFile
  #define IconFile "mook.ico"
#endif

[Setup]
AppId={{8F3D2A61-7C4B-4E92-A15D-6B0E9C3F4D72}
AppName=Mook
AppVersion={#AppVersion}
AppVerName=Mook {#AppVersion}
AppPublisher=Mook
AppPublisherURL=https://github.com/NikoYomi/mook
AppSupportURL=https://github.com/NikoYomi/mook
AppUpdatesURL=https://github.com/NikoYomi/mook/releases
DefaultDirName={autopf}\Mook
DefaultGroupName=Mook
DisableProgramGroupPage=yes
AllowNoIcons=yes
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBase}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; 默认按「仅当前用户」安装到 %LOCALAPPDATA%\Programs\Mook：无需 UAC，
; 且数据目录可写。用户仍可在向导里改成「为所有用户安装」。
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayName=Mook {#AppVersion}
UninstallDisplayIcon={app}\mook.ico
SetupIconFile={#IconFile}
SetupLogging=yes

[Languages]
; 简体中文语言包是 Inno Setup 官方自带文件；CI 会先探测它是否存在，
; 缺失时只编译英文，避免因为语言文件缺消息导致整个打包失败。
#ifdef UseZh
Name: "chinese"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
#endif
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "startupicon"; Description: "Start Mook automatically when Windows starts"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\mook.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\mook-launch.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\mook.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\dist\*"; DestDir: "{app}\dist"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; 快捷方式指向 mook-launch.cmd 而不是 mook.exe：启动脚本会先把
; MOOK_DATA 指到 %LOCALAPPDATA%\Mook\data，避免装到 Program Files 时数据写不进去。
Name: "{group}\Mook"; Filename: "{app}\mook-launch.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\mook.ico"
Name: "{group}\{cm:UninstallProgram,Mook}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Mook"; Filename: "{app}\mook-launch.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\mook.ico"; Tasks: desktopicon
Name: "{userstartup}\Mook"; Filename: "{app}\mook-launch.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\mook.ico"; Tasks: startupicon

[Run]
; 安装完成后用默认浏览器打开服务地址
Filename: "http://localhost:5866"; Description: "{cm:LaunchProgram,Mook}"; Flags: shellexec nowait postinstall skipifsilent
