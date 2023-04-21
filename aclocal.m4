dnl
dnl Local autoconf macros used with mozilla
dnl The contents of this file are under the Public Domain.
dnl

builtin(include, mozilla/build/autoconf/toolchain.m4)dnl
builtin(include, mozilla/build/autoconf/config.status.m4)dnl
builtin(include, mozilla/build/autoconf/nspr.m4)dnl
builtin(include, mozilla/build/autoconf/nss.m4)dnl
builtin(include, mozilla/build/autoconf/pkg.m4)dnl
builtin(include, mozilla/build/autoconf/codeset.m4)dnl
builtin(include, mozilla/build/autoconf/altoptions.m4)dnl
builtin(include, mozilla/build/autoconf/mozprog.m4)dnl
builtin(include, mozilla/build/autoconf/acwinpaths.m4)dnl
builtin(include, mozilla/build/autoconf/lto.m4)dnl
builtin(include, mozilla/build/autoconf/frameptr.m4)dnl
builtin(include, mozilla/build/autoconf/compiler-opts.m4)dnl
builtin(include, mozilla/build/autoconf/zlib.m4)dnl
builtin(include, mozilla/build/autoconf/expandlibs.m4)dnl

MOZ_PROG_CHECKMSYS()

# Read the user's .mozconfig script.  We can't do this in
# configure.in: autoconf puts the argument parsing code above anything
# expanded from configure.in, and we need to get the configure options
# from .mozconfig in place before that argument parsing code.
dnl MOZ_READ_MOZCONFIG(mozilla)
