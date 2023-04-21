#!/bin/csh -f

# from AuroraFox, modified for TenFourFox, and modified again for SeaLion.

set ppath="$1"
if ("$ppath" == "/" || "$ppath" == "") then
	echo 'invalid path'
	exit
endif
if (-e "$ppath/Contents/MacOS/firefox") then
	rm -rf "$ppath" || exit
endif

set verbose
cp -RL obj-x86_64-apple-darwin10.8.0/dist/SeaLion.app "$ppath" || exit
cd $ppath/Contents/MacOS || exit