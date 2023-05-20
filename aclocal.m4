dnl
dnl Local autoconf macros used with UXP
dnl The contents of this file are under the Public Domain.
dnl

builtin(include, platform/build/autoconf/toolchain.m4)dnl
builtin(include, platform/build/autoconf/config.status.m4)dnl
builtin(include, platform/build/autoconf/nspr.m4)dnl
builtin(include, platform/build/autoconf/nss.m4)dnl
builtin(include, platform/build/autoconf/pkg.m4)dnl
builtin(include, platform/build/autoconf/codeset.m4)dnl
builtin(include, platform/build/autoconf/altoptions.m4)dnl
builtin(include, platform/build/autoconf/mozprog.m4)dnl
builtin(include, platform/build/autoconf/acwinpaths.m4)dnl
builtin(include, platform/build/autoconf/lto.m4)dnl
builtin(include, platform/build/autoconf/frameptr.m4)dnl
builtin(include, platform/build/autoconf/compiler-opts.m4)dnl
builtin(include, platform/build/autoconf/zlib.m4)dnl
builtin(include, platform/build/autoconf/expandlibs.m4)dnl

MOZ_PROG_CHECKMSYS()

# Read the user's .mozconfig script.  We can't do this in
# configure.in: autoconf puts the argument parsing code above anything
# expanded from configure.in, and we need to get the configure options
# from .mozconfig in place before that argument parsing code.
dnl MOZ_READ_MOZCONFIG(platform)
