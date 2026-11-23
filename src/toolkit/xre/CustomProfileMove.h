/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 NamiSwan222. See LICENSE-MIT. */

#ifndef CustomProfileMove_h
#define CustomProfileMove_h

// Up to 0.2.x the browser kept its data under its working name: the folders
// "jessnix" in %APPDATA% (profiles, with logins and settings) and in
// %LOCALAPPDATA% (caches). The folders are now named after MOZ_APP_PROFILE.
// The first start after an update moves the old folder to the new name, so the
// profile list, and with it every login, carries over.
//
// Called from nsXREDirProvider::GetUserDataDirectory, before the data folder
// is created. The move is one rename: it happens whole or not at all.

#include <windows.h>

#include "nsCOMPtr.h"
#include "nsIFile.h"
#include "nsString.h"
#ifdef MOZ_BACKGROUNDTASKS
#  include "mozilla/BackgroundTasks.h"
#endif

// aDir: the data folder about to be used. aProfileName: MOZ_APP_PROFILE.
// aLocal: the cache folder (%LOCALAPPDATA%), which is fine to start empty.
inline nsresult CustomBrowserMoveOldUserData(nsIFile* aDir,
                                             const char* aProfileName,
                                             bool aLocal) {
  static const wchar_t kOldName[] = L"jessnix";

  if (!aDir || !aProfileName) {
    return NS_OK;
  }
  // Only the folder this build names itself; a folder given through
  // MOZ_APP_DATA under another name is someone's own arrangement.
  nsAutoString leaf;
  if (NS_FAILED(aDir->GetLeafName(leaf)) ||
      !leaf.LowerCaseEqualsASCII(aProfileName)) {
    return NS_OK;
  }
  bool exists = false;
  if (NS_FAILED(aDir->Exists(&exists)) || exists) {
    return NS_OK;
  }
  nsCOMPtr<nsIFile> old;
  if (NS_FAILED(aDir->GetParent(getter_AddRefs(old))) || !old ||
      NS_FAILED(old->Append(nsDependentString(kOldName)))) {
    return NS_OK;
  }
  bool isDirectory = false;
  if (NS_FAILED(old->IsDirectory(&isDirectory)) || !isDirectory) {
    return NS_OK;
  }

  nsAutoString from, to;
  if (NS_FAILED(old->GetPath(from)) || NS_FAILED(aDir->GetPath(to))) {
    return NS_OK;
  }
  if (::MoveFileExW(from.get(), to.get(), 0)) {
    return NS_OK;
  }
  if (aLocal) {
    return NS_OK;
  }

  // Something still has the old folder open (an older copy of the browser
  // that is still running, most likely). Starting with an empty folder would
  // look like every login was lost, so stop here; the next start tries again.
  bool quiet = false;
#ifdef MOZ_BACKGROUNDTASKS
  quiet = mozilla::BackgroundTasks::IsBackgroundTaskMode();
#endif
  if (!quiet) {
    ::MessageBoxW(nullptr,
                  L"Custom Browser is moving your profile to its new folder, "
                  L"but something still has the old folder open.\n\n"
                  L"Close every Custom Browser window, then start it again.",
                  L"Custom Browser", MB_OK | MB_ICONWARNING | MB_SETFOREGROUND);
  }
  return NS_ERROR_FILE_IS_LOCKED;
}

#endif  // CustomProfileMove_h
