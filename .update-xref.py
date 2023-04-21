#!/bin/bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# ===| BASH Stub |=============================================================

# The beginning of this script is both valid shell and valid python,
# such that the script starts with the shell and is reexecuted with
# the right python.
'''echo' $0: Starting up...
if [ -f "/opt/rh/python27/root/usr/bin/python2.7" ];then
    BINOC_PYTHON_ARGS=$@
    exec scl enable python27 "python $0 $BINOC_PYTHON_ARGS"
elif BINOC_PYTHON_PATH="$(which python2.7 2>/dev/null)"; then
    exec $BINOC_PYTHON_PATH $0 "$@"
else
    echo "$0 error: Python 2.7 was not found on this system"
    exit 1
fi
'''
# =============================================================================

# ===| Imports |===============================================================

from __future__ import print_function
import os
import sys
import subprocess
import platform

# =============================================================================

# ===| Global Variables |======================================================

strScriptPath = os.path.abspath(os.path.dirname(__file__))
strProjectsPath = strScriptPath + '/projects/'
strGitBinary = ''

# =============================================================================

# ===| Function: Output Message |==============================================

def funcOutputMessage(_messageType, _messageBody):
    _messagePrefix = 'update:'
    _errorPrefix = '{0} error:'.format(_messagePrefix)      
    _messageTemplates = {
        'statusGen'  : '{0} {1}'.format(_messagePrefix, _messageBody),
        'statusDep1' : '{0} Searching for {1}...'.format(_messagePrefix, _messageBody),
        'statusDep2' : '{0} Found {1}'.format(_messagePrefix, _messageBody),
        'errorGen' : '{0} {1}'.format(_errorPrefix, _messageBody),
        'errorDep' : '{0} {1} was not found on your system!'.format(_errorPrefix, _messageBody)
    }
    
    if _messageType in _messageTemplates:
        print(_messageTemplates[_messageType])
        if _messageTemplates[_messageType].find('error') != -1:
            sys.exit(1)
    else:
        print('{0} Unknown error - Referenced as \'{1}\' internally.'.format(_messagePrefix, _messageType))
        sys.exit(1)

# =============================================================================

# ===| Prerequisites |=========================================================

### Check for Git
funcOutputMessage("statusDep1", "Git")
if platform.system() == "Windows":
    if os.path.exists(os.path.normpath("c:/Program Files/Git/bin/git.exe")):
        strGitBinary = os.path.normpath("c:/Program Files/Git/bin/git.exe")
        funcOutputMessage("statusDep2", strGitBinary)
    elif os.path.exists(os.path.normpath("c:/Program Files (x86)/Git/bin/git.exe")):
        strGitBinary = os.path.normpath("c:/Program Files (x86)/Git/bin/git.exe")
        funcOutputMessage("statusDep2", strGitBinary)
    else:
       funcOutputMessage("errorDep", "Git")
elif platform.system() == "Linux":
    if os.path.exists("/usr/bin/git"):
        strGitBinary = "git"
        funcOutputMessage("statusDep2", strGitBinary)
    else:
        funcOutputMessage("errorDep", "Git")

# =============================================================================

# ===| Main |==================================================================

strSubPath = ''

# ambassador
strSubPath = '/mozilla/application/ambassador/'
funcOutputMessage('statusGen', 'Updating ambassador repository')
subprocess.call('"{0}" {1}'.format(strGitBinary, 'checkout'), shell=True, cwd=strScriptPath + strSubPath)
subprocess.call('"{0}" {1}'.format(strGitBinary, 'pull'), shell=True, cwd=strScriptPath + strSubPath)

# iceweasel-uxp
# strSubPath = '/mozilla/application/iceweasel-uxp/'
# funcOutputMessage('statusGen', 'Updating iceweasel repository')
# subprocess.call('"{0}" {1}'.format(strGitBinary, 'checkout'), shell=True, cwd=strScriptPath + strSubPath)
# subprocess.call('"{0}" {1}'.format(strGitBinary, 'pull'), shell=True, cwd=strScriptPath + strSubPath)

strSubPath = '/mozilla/'
funcOutputMessage('statusGen', 'Updating unified xul platform repository')
subprocess.call('"{0}" {1}'.format(strGitBinary, 'submodule update'), shell=True, cwd=strScriptPath)

# top-level
funcOutputMessage('statusGen', 'Updating top-level repository')
subprocess.call('"{0}" {1}'.format(strGitBinary, 'checkout'), shell=True, cwd=strScriptPath)
subprocess.call('"{0}" {1}'.format(strGitBinary, 'pull'), shell=True, cwd=strScriptPath)

# =============================================================================
