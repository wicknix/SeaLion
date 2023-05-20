from datetime import date
from datetime import timedelta
from datetime import datetime
import sys
import argparse

moduleOptionParser = argparse.ArgumentParser()
moduleOptionParser.add_argument("--version", "-v", dest="version", nargs="*")
moduleOptionParser.add_argument("--msbuild", "-b", dest="msbuild", action="store_true")
moduleOptionParser.add_argument("--msbuilddate", "-bd", dest="msbuilddate")
moduleOptionParser.add_argument("--msdate", "-d", dest="msdate", type=int)
moduleOptionParser.add_argument("--edate", "-e", dest="edate", action="store_true")
moduleOptionParser.add_argument("--edateonly", "-ed", dest="edateonly", action="store_true")
args = moduleOptionParser.parse_args()

msBuildToday = str((datetime.utcnow().date()-date(2000,01,01)).days)

if len(sys.argv) <= 1:
  moduleOptionParser.print_help()
  sys.exit(1)

if args.version:
  with open(args.version[0]) as f:
    strVersion = f.readline()
  f.close()

  if (strVersion.endswith('.0000')):
    strVersion = strVersion.replace('.0000', '.' + msBuildToday + 'a1')
  
  if len(args.version) == 2 and args.version[1] == 'build':   
    if strVersion.endswith(('a1', '.1')):
      print strVersion[len(strVersion) - 6:]
    else:
      print strVersion[len(strVersion) - 4:]
  else:
    print strVersion
  
  sys.exit(0)

if args.msbuild:
  print msBuildToday
  sys.exit(0)

if args.msdate:
  print date(2000,01,01)+timedelta(days=args.msdate)
  sys.exit(0)

if args.msbuilddate:
  if '-' in args.msbuilddate:
    print (datetime.strptime(args.msbuilddate, '%Y-%m-%d').date()-date(2000,01,01)).days
  elif '/' in args.msbuilddate:
    print (datetime.strptime(args.msbuilddate, '%Y/%m/%d').date()-date(2000,01,01)).days
  else:
    print (datetime.strptime(args.msbuilddate, '%Y%m%d').date()-date(2000,01,01)).days
  sys.exit(0)


if args.edate:
  print datetime.utcnow().strftime('%Y%m%d.%H%M')
  sys.exit(0)

if args.edateonly:
  print datetime.utcnow().strftime('%Y%m%d')
  sys.exit(0)