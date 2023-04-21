from datetime import date
from datetime import timedelta
from datetime import datetime
import sys
import argparse

moduleOptionParser = argparse.ArgumentParser()
moduleOptionParser.add_argument("--version", "-v", dest="version", nargs="*")
moduleOptionParser.add_argument("--msbuild", "-b", dest="msbuild", action="store_true")
moduleOptionParser.add_argument("--msdate", "-d", dest="msdate", type=int)
moduleOptionParser.add_argument("--edate", "-e", dest="edate", action="store_true")
args = moduleOptionParser.parse_args()

if len(sys.argv) <= 1:
  moduleOptionParser.print_help()
  sys.exit(1)

if args.version:
  with open(args.version[0]) as f:
    strVersion = f.readline()
  f.close()

  if (strVersion == '52.9.0000'):
    strVersion = '{0}.{1}'.format('52.9', (datetime.utcnow().date()-date(2000,01,01)).days)
  
  if len(args.version) == 2 and args.version[1] == 'build':
    print strVersion[5:]
  else:
    print strVersion
  
  sys.exit(0)

if args.msbuild:
  print (datetime.utcnow().date()-date(2000,01,01)).days
  sys.exit(0)

if args.msdate:
  print date(2000,01,01)+timedelta(days=args.msdate)
  sys.exit(0)

if args.edate:
  print datetime.utcnow().strftime('%Y%m%d.%H%M')
  sys.exit(0)
