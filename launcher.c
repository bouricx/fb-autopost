#define UNICODE
#define _UNICODE
#include <windows.h>
#include <wchar.h>
int WINAPI wWinMain(HINSTANCE instance,HINSTANCE previous,PWSTR args,int show){
 HANDLE mutex=CreateMutexW(NULL,FALSE,L"Local\\FB-AutoPost-Desktop-1.3.1");
 if(!mutex)return 1;
 if(GetLastError()==ERROR_ALREADY_EXISTS){
  HWND window=FindWindowW(NULL,L"FB AutoPost 1.3.1 · Liquid Glass");
  if(window){ShowWindow(window,SW_RESTORE);SetForegroundWindow(window);}
  else MessageBoxW(NULL,L"FB AutoPost is already starting or running. Check the taskbar.",L"FB AutoPost",MB_OK);
  CloseHandle(mutex);return 0;
 }
 wchar_t root[32768],python[32768],folder[32768],command[32768];
 DWORD n=GetModuleFileNameW(NULL,root,32768);if(!n||n>=32768)return 1;
 wchar_t *slash=wcsrchr(root,L'\\');if(!slash)return 1;*slash=0;
 if(swprintf(python,32768,L"%ls\\runtime\\pythonw.exe",root)<0||swprintf(folder,32768,L"%ls\\app",root)<0||swprintf(command,32768,L"\"%ls\" main.py",python)<0)return 1;
 STARTUPINFOW si={0};si.cb=sizeof(si);PROCESS_INFORMATION pi={0};
 if(!CreateProcessW(python,command,NULL,NULL,FALSE,CREATE_NO_WINDOW,NULL,folder,&si,&pi)){
  MessageBoxW(NULL,L"Cannot open FB AutoPost. Extract the whole package or download the latest installer.",L"FB AutoPost startup error",MB_OK|MB_ICONERROR);CloseHandle(mutex);return 1;
 }
 CloseHandle(pi.hThread);WaitForSingleObject(pi.hProcess,INFINITE);DWORD result=1;GetExitCodeProcess(pi.hProcess,&result);CloseHandle(pi.hProcess);CloseHandle(mutex);return (int)result;
}
