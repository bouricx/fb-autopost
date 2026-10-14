#define UNICODE
#define _UNICODE
#include <windows.h>
#include <wchar.h>
#include <stdio.h>
int wmain(void) {
 wchar_t root[32768],python[32768],folder[32768],command[32768];
 DWORD n=GetModuleFileNameW(NULL,root,32768);
 if(!n || n>=32768) return 1;
 wchar_t *slash=wcsrchr(root,L'\\');if(!slash)return 1;*slash=0;
 if(swprintf(python,32768,L"%ls\\runtime\\python.exe",root)<0 ||
    swprintf(folder,32768,L"%ls\\app",root)<0 ||
    swprintf(command,32768,L"\"%ls\" main.py",python)<0)return 1;
 STARTUPINFOW si={0};si.cb=sizeof(si);PROCESS_INFORMATION pi={0};
 SetConsoleTitleW(L"FB AutoPost - keep this window open");
 if(!CreateProcessW(python,command,NULL,NULL,FALSE,0,NULL,folder,&si,&pi)){
  fwprintf(stderr,L"Cannot start app (Windows error %lu). Extract the whole ZIP first.\n",GetLastError());
  MessageBoxW(NULL,L"Extract the whole ZIP into a writable folder, then run FB-AutoPost.exe.",L"FB AutoPost startup failed",MB_OK|MB_ICONERROR);return 1;
 }
 CloseHandle(pi.hThread);WaitForSingleObject(pi.hProcess,INFINITE);
 DWORD result=1;GetExitCodeProcess(pi.hProcess,&result);CloseHandle(pi.hProcess);
 if(result){fwprintf(stderr,L"App exited with error %lu. Press Enter to close.\n",result);getwchar();}
 return (int)result;
}
