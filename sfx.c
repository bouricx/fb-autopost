#define UNICODE
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <wchar.h>
int wmain(void){
 wchar_t self[32768],tmp[MAX_PATH],zip[MAX_PATH],base[32768],dest[32768],shell[32768],command[32768];
 if(!GetModuleFileNameW(NULL,self,32768)||!GetTempPathW(MAX_PATH,tmp)||!GetTempFileNameW(tmp,L"fba",0,zip)||!GetEnvironmentVariableW(L"LOCALAPPDATA",base,32768))return 1;
 swprintf(dest,32768,L"%ls\\FB-AutoPost\\v1.3.0",base);
 HANDLE in=CreateFileW(self,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,0,NULL);
 HANDLE out=CreateFileW(zip,GENERIC_WRITE,0,NULL,CREATE_ALWAYS,0,NULL);
 if(in==INVALID_HANDLE_VALUE||out==INVALID_HANDLE_VALUE)return 1;
 LARGE_INTEGER size,pos;uint64_t bytes;DWORD got,written;
 GetFileSizeEx(in,&size);pos.QuadPart=size.QuadPart-8;SetFilePointerEx(in,pos,NULL,FILE_BEGIN);
 if(!ReadFile(in,&bytes,8,&got,NULL)||got!=8||bytes>(uint64_t)size.QuadPart-8)return 1;
 pos.QuadPart=size.QuadPart-8-(LONGLONG)bytes;SetFilePointerEx(in,pos,NULL,FILE_BEGIN);
 char buffer[65536];while(bytes){DWORD count=bytes>sizeof(buffer)?sizeof(buffer):(DWORD)bytes;
 if(!ReadFile(in,buffer,count,&got,NULL)||got!=count||!WriteFile(out,buffer,got,&written,NULL)||written!=got)return 1;bytes-=got;}
 CloseHandle(in);CloseHandle(out);SetEnvironmentVariableW(L"FBAUTO_ARCHIVE",zip);SetEnvironmentVariableW(L"FBAUTO_DEST",dest);
 GetSystemDirectoryW(shell,32768);wcscat(shell,L"\\WindowsPowerShell\\v1.0\\powershell.exe");
 swprintf(command,32768,L"\"%ls\" -NoProfile -Command \"$ErrorActionPreference='Stop'; $app=Join-Path $env:FBAUTO_DEST 'FB-AutoPost'; if (!(Test-Path (Join-Path $app 'runtime/python.exe'))) { New-Item -ItemType Directory -Force -Path $env:FBAUTO_DEST | Out-Null; $zip=$env:FBAUTO_ARCHIVE+'.zip'; Move-Item -LiteralPath $env:FBAUTO_ARCHIVE -Destination $zip; Expand-Archive -LiteralPath $zip -DestinationPath $env:FBAUTO_DEST -Force; Remove-Item -LiteralPath $zip }; Remove-Item -LiteralPath $env:FBAUTO_ARCHIVE -ErrorAction SilentlyContinue; & (Join-Path $app 'FB-AutoPost.exe'); exit $LASTEXITCODE\"",shell);
 STARTUPINFOW si={0};si.cb=sizeof(si);PROCESS_INFORMATION pi={0};
 wprintf(L"FB AutoPost 1.3 - preparing local app, please wait...\n");
 if(!CreateProcessW(shell,command,NULL,NULL,FALSE,0,NULL,NULL,&si,&pi)){DeleteFileW(zip);return 1;}
 CloseHandle(pi.hThread);WaitForSingleObject(pi.hProcess,INFINITE);DWORD result;GetExitCodeProcess(pi.hProcess,&result);CloseHandle(pi.hProcess);DeleteFileW(zip);
 if(result){wprintf(L"Startup failed. Press Enter to close.\n");getwchar();}return result;
}
