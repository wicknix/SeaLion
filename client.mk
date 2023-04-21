# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# Build a comm application (Mozilla calendar, mail or suite).
#
# To build a tree,
#    1. hg clone http://hg.mozilla.org/comm-central comm
#    2. cd comm
#    3. python client.py checkout
#    4. create your .mozconfig file with
#       ac_add_options --enable-application=suite
#         (or mail, or calendar)
#    5. gmake -f client.mk
#
# Other targets (gmake -f client.mk [targets...]),
#    build
#    clean
#    distclean
#
# See http://developer.mozilla.org/en/Build_Documentation for
# more information.
#
# Options:
#   MOZ_BUILD_PROJECTS   - Build multiple projects in subdirectories
#                          of MOZ_OBJDIR
#   MOZ_OBJDIR           - Destination object directory
#   MOZ_MAKE_FLAGS       - Flags to pass to $(MAKE)
#   MOZ_PREFLIGHT_ALL  } - Makefiles to run before any project in
#   MOZ_PREFLIGHT      }   MOZ_BUILD_PROJECTS, before each project, after
#   MOZ_POSTFLIGHT     }   each project, and after all projects; these
#   MOZ_POSTFLIGHT_ALL }   variables contain space-separated lists
#   MOZ_UNIFY_BDATE      - Set to use the same bdate for each project in
#                          MOZ_BUILD_PROJECTS
#
#######################################################################
# Defines

comma := ,

CWD := $(CURDIR)
ifneq (1,$(words $(CWD)))
$(error The mozilla directory cannot be located in a path with spaces.)
endif

ifeq "$(CWD)" "/"
CWD   := /.
endif

ifndef TOPSRCDIR
ifeq (,$(wildcard client.mk))
TOPSRCDIR := $(patsubst %/,%,$(dir $(MAKEFILE_LIST)))
else
TOPSRCDIR := $(CWD)
endif
endif

SH := /bin/sh
PERL ?= perl
PYTHON ?= $(shell which python2.7 > /dev/null 2>&1 && echo python2.7 || echo python)

CONFIG_GUESS_SCRIPT := $(wildcard $(TOPSRCDIR)/build/autoconf/config.guess)
ifdef CONFIG_GUESS_SCRIPT
  CONFIG_GUESS := $(shell $(CONFIG_GUESS_SCRIPT))
endif


####################################
# Sanity checks

# Windows checks.
ifneq (,$(findstring mingw,$(CONFIG_GUESS)))

# check for CRLF line endings
ifneq (0,$(shell $(PERL) -e 'binmode(STDIN); while (<STDIN>) { if (/\r/) { print "1"; exit } } print "0"' < $(TOPSRCDIR)/client.mk))
$(error This source tree appears to have Windows-style line endings. To \
convert it to Unix-style line endings, check \
"https://developer.mozilla.org/en-US/docs/Developer_Guide/Mozilla_build_FAQ\#Win32-specific_questions" \
for a workaround of this issue.)
endif
endif

####################################
# Load mozconfig Options

# See build pages, http://www.mozilla.org/build/ for how to set up mozconfig.

MOZCONFIG_LOADER := build/autoconf/mozconfig2client-mk

define CR


endef

# As $(shell) doesn't preserve newlines, use sed to replace them with an
# unlikely sequence (||), which is then replaced back to newlines by make
# before evaluation. $(shell) replacing newlines with spaces, || is always
# followed by a space (since sed doesn't remove newlines), except on the
# last line, so replace both '|| ' and '||'.
# Also, make MOZ_PGO available to mozconfig when passed on make command line.
MOZCONFIG_CONTENT := $(subst ||,$(CR),$(subst || ,$(CR),$(shell MOZ_PGO=$(MOZ_PGO) $(TOPSRCDIR)/$(MOZCONFIG_LOADER) $(TOPSRCDIR) | sed 's/$$/||/')))
$(eval $(MOZCONFIG_CONTENT))

export FOUND_MOZCONFIG

# As '||' was used as a newline separator, it means it's not occurring in
# lines themselves. It can thus safely be used to replaces normal spaces,
# to then replace newlines with normal spaces. This allows to get a list
# of mozconfig output lines.
MOZCONFIG_OUT_LINES := $(subst $(CR), ,$(subst $(NULL) $(NULL),||,$(MOZCONFIG_CONTENT)))
# Filter-out comments from those lines.
START_COMMENT = \#
MOZCONFIG_OUT_FILTERED := $(filter-out $(START_COMMENT)%,$(MOZCONFIG_OUT_LINES))

ifdef MOZ_PGO
export MOZ_PGO
endif

# Automatically add -jN to make flags if not defined. N defaults to number of cores.
ifeq (,$(findstring -j,$(MOZ_MAKE_FLAGS)))
  cores=$(shell $(PYTHON) -c 'import multiprocessing; print(multiprocessing.cpu_count())')
  MOZ_MAKE_FLAGS += -j$(cores)
endif


ifndef MOZ_OBJDIR
  MOZ_OBJDIR = obj-$(CONFIG_GUESS)
else
# On Windows Pymake builds check MOZ_OBJDIR doesn't start with "/"
  ifneq (,$(findstring mingw,$(CONFIG_GUESS)))
  ifeq (1_a,$(.PYMAKE)_$(firstword a$(subst /, ,$(MOZ_OBJDIR))))
  $(error For Windows Pymake builds, MOZ_OBJDIR must be a Windows [and not MSYS] style path.)
  endif
  endif
endif

ifdef MOZ_BUILD_PROJECTS

ifdef MOZ_CURRENT_PROJECT
  OBJDIR = $(MOZ_OBJDIR)/$(MOZ_CURRENT_PROJECT)
  MOZ_MAKE = $(MAKE) $(MOZ_MAKE_FLAGS) -C $(OBJDIR)
  BUILD_PROJECT_ARG = MOZ_BUILD_APP=$(MOZ_CURRENT_PROJECT)
else
  OBJDIR = $(error Cannot find the OBJDIR when MOZ_CURRENT_PROJECT is not set.)
  MOZ_MAKE = $(error Cannot build in the OBJDIR when MOZ_CURRENT_PROJECT is not set.)
endif

else # MOZ_BUILD_PROJECTS

OBJDIR = $(MOZ_OBJDIR)
MOZ_MAKE = $(MAKE) $(MOZ_MAKE_FLAGS) -C $(OBJDIR)

endif # MOZ_BUILD_PROJECTS

# If we have a MOZ_OBJDIR that's set from the environment, ensure that it is an
# absolute path.
ifdef MOZ_OBJDIR
MOZ_OBJDIR := $(shell $(PYTHON) -c "import os.path; print(os.path.join(\"$(TOPSRCDIR)\", \"$(MOZ_OBJDIR)\").replace('\\\\','/'))")
endif

# 'configure' scripts generated by autoconf.
CONFIGURES := $(TOPSRCDIR)/configure
CONFIGURES += $(TOPSRCDIR)/mozilla/configure
CONFIGURES += $(TOPSRCDIR)/mozilla/js/src/configure

# Make targets that are going to be passed to the real build system
OBJDIR_TARGETS = install export libs clean realclean distclean maybe_clobber_profiledbuild upload sdk installer package package-compare stage-package source-package l10n-check automation/build

#######################################################################
# Rules

# The default rule is build
build::

# Define mkdir
include $(TOPSRCDIR)/config/makefiles/makeutils.mk
include $(TOPSRCDIR)/config/makefiles/autotargets.mk

# Create a makefile containing the mk_add_options values from mozconfig,
# but only do so when OBJDIR is defined (see further above).
ifdef MOZ_BUILD_PROJECTS
ifdef MOZ_CURRENT_PROJECT
WANT_MOZCONFIG_MK = 1
else
WANT_MOZCONFIG_MK =
endif
else
WANT_MOZCONFIG_MK = 1
endif

ifdef WANT_MOZCONFIG_MK
# For now, only output "export" lines from mozconfig2client-mk output.
MOZCONFIG_MK_LINES := $(filter export||%,$(MOZCONFIG_OUT_LINES))
$(OBJDIR)/.mozconfig.mk: $(FOUND_MOZCONFIG) $(call mkdir_deps,$(OBJDIR))
	$(if $(MOZCONFIG_MK_LINES),( $(foreach line,$(MOZCONFIG_MK_LINES), echo "$(subst ||, ,$(line))";) )) > $@
ifdef MOZ_CURRENT_PROJECT
	echo export MOZ_CURRENT_PROJECT=$(MOZ_CURRENT_PROJECT) >> $@
endif

# Include that makefile so that it is created. This should not actually change
# the environment since MOZCONFIG_CONTENT, which MOZCONFIG_OUT_LINES derives
# from, has already been eval'ed.
include $(OBJDIR)/.mozconfig.mk
endif

# UPLOAD_EXTRA_FILES is appended to and exported from mozconfig, which makes
# submakes as well as configure add even more to that, so just unexport it
# for submakes to pick it from .mozconfig.mk and for configure to pick it
# from mach environment.
unexport UPLOAD_EXTRA_FILES

# These targets are candidates for auto-running client.py

ifeq (01,$(MAKELEVEL)$(if $(ALWAYS_RUN_CLIENT_PY),1,))

build profiledbuild configure:: run_client_py
	$(MAKE) -f $(TOPSRCDIR)/client.mk $@
else


# Print out any options loaded from mozconfig.
all build clean distclean export libs install realclean::
ifneq (,$(strip $(MOZCONFIG_OUT_FILTERED)))
	$(info Adding client.mk options from $(FOUND_MOZCONFIG):)
	$(foreach line,$(MOZCONFIG_OUT_FILTERED),$(info $(NULL) $(NULL) $(NULL) $(NULL) $(subst ||, ,$(line))))
endif

# Windows equivalents
build_all: build
clobber clobber_all: clean

# Do everything from scratch
everything: clean build

####################################
# Profile-Guided Optimization
#  To use this, you should set the following variables in your mozconfig
#    mk_add_options PROFILE_GEN_SCRIPT=/path/to/profile-script
#
#  The profile script should exercise the functionality to be included
#  in the profile feedback.
#
#  This is up here, outside of the MOZ_CURRENT_PROJECT logic so that this
#  is usable in multi-pass builds, where you might not have a runnable
#  application until all the build passes and postflight scripts have run.
ifdef MOZ_OBJDIR
  PGO_OBJDIR = $(MOZ_OBJDIR)
else
  PGO_OBJDIR := $(TOPSRCDIR)
endif

profiledbuild::
	$(MAKE) -f $(TOPSRCDIR)/client.mk build MOZ_PROFILE_GENERATE=1
	$(MAKE) -C $(PGO_OBJDIR) stage-package
	OBJDIR=${PGO_OBJDIR} $(PROFILE_GEN_SCRIPT)
	$(MAKE) -f $(TOPSRCDIR)/client.mk maybe_clobber_profiledbuild
	$(MAKE) -f $(TOPSRCDIR)/client.mk build MOZ_PROFILE_USE=1

#####################################################
# Build date unification

ifdef MOZ_UNIFY_BDATE
ifndef MOZ_BUILD_DATE
ifdef MOZ_BUILD_PROJECTS
MOZ_BUILD_DATE = $(shell $(PYTHON) $(TOPSRCDIR)/mozilla/build/variables.py buildid_header | awk '{print $$3}')
export MOZ_BUILD_DATE
endif
endif
endif

#####################################################
# Preflight, before building any project

build preflight_all::
ifeq (,$(MOZ_CURRENT_PROJECT)$(if $(MOZ_PREFLIGHT_ALL),,1))
# Don't run preflight_all for individual projects in multi-project builds
# (when MOZ_CURRENT_PROJECT is set.)
ifndef MOZ_BUILD_PROJECTS
# Building a single project, OBJDIR is usable.
	set -e; \
	for mkfile in $(MOZ_PREFLIGHT_ALL); do \
	  $(MAKE) -f $(TOPSRCDIR)/$$mkfile preflight_all TOPSRCDIR=$(TOPSRCDIR) OBJDIR=$(OBJDIR) MOZ_OBJDIR=$(MOZ_OBJDIR); \
	done
else
# OBJDIR refers to the project-specific OBJDIR, which is not available at
# this point when building multiple projects.  Only MOZ_OBJDIR is available.
	set -e; \
	for mkfile in $(MOZ_PREFLIGHT_ALL); do \
	  $(MAKE) -f $(TOPSRCDIR)/$$mkfile preflight_all TOPSRCDIR=$(TOPSRCDIR) MOZ_OBJDIR=$(MOZ_OBJDIR) MOZ_BUILD_PROJECTS='$(MOZ_BUILD_PROJECTS)'; \
	done
endif
endif

# If we're building multiple projects, but haven't specified which project,
# loop through them.

ifeq (,$(MOZ_CURRENT_PROJECT)$(if $(MOZ_BUILD_PROJECTS),,1))
configure build preflight postflight $(OBJDIR_TARGETS)::
	set -e; \
	for app in $(MOZ_BUILD_PROJECTS); do \
	  $(MAKE) -f $(TOPSRCDIR)/client.mk $@ MOZ_CURRENT_PROJECT=$$app; \
	done

else

# MOZ_CURRENT_PROJECT: either doing a single-project build, or building an
# individual project in a multi-project build.

####################################
# Configure

MAKEFILE      = $(wildcard $(OBJDIR)/Makefile)
CONFIG_STATUS = $(wildcard $(OBJDIR)/config.status)
CONFIG_CACHE  = $(wildcard $(OBJDIR)/config.cache)

EXTRA_CONFIG_DEPS := \
	$(TOPSRCDIR)/aclocal.m4 \
	$(TOPSRCDIR)/mozilla/aclocal.m4 \
	$(TOPSRCDIR)/mozilla/old-configure.in \
	$(wildcard $(TOPSRCDIR)/mozilla/build/autoconf/*.m4) \
	$(TOPSRCDIR)/mozilla/js/src/aclocal.m4 \
	$(TOPSRCDIR)/mozilla/js/src/old-configure.in \
	$(NULL)

$(CONFIGURES): %: %.in $(EXTRA_CONFIG_DEPS)
	@echo Generating $@
	sed '1,/^divert/d' $< > $@
	chmod +x $@

CONFIG_STATUS_DEPS := \
	$(wildcard $(CONFIGURES)) \
	$(wildcard $(TOPSRCDIR)/mozilla/nsprpub/configure) \
	$(wildcard $(TOPSRCDIR)/mozilla/config/milestone.txt) \
	$(wildcard $(TOPSRCDIR)/ldap/sdks/c-sdk/configure) \
	$(wildcard $(addsuffix confvars.sh,$(wildcard $(TOPSRCDIR)/*/))) \
	$(NULL)

CONFIGURE_ENV_ARGS += \
  MAKE='$(MAKE)' \
  $(NULL)

# configure uses the program name to determine @srcdir@. Calling it without
#   $(TOPSRCDIR) will set @srcdir@ to '.'; otherwise, it is set to the full
#   path of $(TOPSRCDIR).
ifeq ($(TOPSRCDIR),$(OBJDIR))
  CONFIGURE = ./configure
else
  CONFIGURE = $(TOPSRCDIR)/configure
endif

configure-files: $(CONFIGURES)

configure-preqs = \
  configure-files \
  $(call mkdir_deps,$(OBJDIR)) \
  $(if $(MOZ_BUILD_PROJECTS),$(call mkdir_deps,$(MOZ_OBJDIR))) \
  $(NULL)

configure:: $(configure-preqs)
	@echo cd $(OBJDIR);
	@echo $(CONFIGURE) $(CONFIGURE_ARGS)
	@cd $(OBJDIR) && $(BUILD_PROJECT_ARG) $(CONFIGURE_ENV_ARGS) $(CONFIGURE) $(CONFIGURE_ARGS) \
	  || ( echo '*** Fix above errors and then restart with\
               "$(MAKE) -f client.mk build"' && exit 1 )
	@touch $(OBJDIR)/Makefile

ifneq (,$(MAKEFILE))
$(OBJDIR)/Makefile: $(OBJDIR)/config.status

$(OBJDIR)/config.status: $(CONFIG_STATUS_DEPS)
else
$(OBJDIR)/Makefile: $(CONFIG_STATUS_DEPS)
endif
	@$(MAKE) -f $(TOPSRCDIR)/client.mk configure

ifneq (,$(CONFIG_STATUS))
$(OBJDIR)/config/autoconf.mk: $(TOPSRCDIR)/config/autoconf.mk.in
	$(PYTHON) $(OBJDIR)/config.status -n --file=$(OBJDIR)/config/autoconf.mk
endif


####################################
# Preflight

build preflight::
ifdef MOZ_PREFLIGHT
	set -e; \
	for mkfile in $(MOZ_PREFLIGHT); do \
	  $(MAKE) -f $(TOPSRCDIR)/$$mkfile preflight TOPSRCDIR=$(TOPSRCDIR) OBJDIR=$(OBJDIR) MOZ_OBJDIR=$(MOZ_OBJDIR); \
	done
endif

####################################
# Build it

build::  $(OBJDIR)/Makefile $(OBJDIR)/config.status
	+$(MOZ_MAKE)

####################################
# Other targets

# Pass these target onto the real build system
$(OBJDIR_TARGETS):: $(OBJDIR)/Makefile $(OBJDIR)/config.status
	+$(MOZ_MAKE) $@

####################################
# Postflight

build postflight::
ifdef MOZ_POSTFLIGHT
	set -e; \
	for mkfile in $(MOZ_POSTFLIGHT); do \
	  $(MAKE) -f $(TOPSRCDIR)/$$mkfile postflight TOPSRCDIR=$(TOPSRCDIR) OBJDIR=$(OBJDIR) MOZ_OBJDIR=$(MOZ_OBJDIR); \
	done
endif

endif # MOZ_CURRENT_PROJECT
endif # RAN_CLIENT_PY

####################################
# Postflight, after building all projects

build postflight_all::
ifeq (,$(MOZ_CURRENT_PROJECT)$(if $(MOZ_POSTFLIGHT_ALL),,1))
# Don't run postflight_all for individual projects in multi-project builds
# (when MOZ_CURRENT_PROJECT is set.)
ifndef MOZ_BUILD_PROJECTS
# Building a single project, OBJDIR is usable.
	set -e; \
	for mkfile in $(MOZ_POSTFLIGHT_ALL); do \
	  $(MAKE) -f $(TOPSRCDIR)/$$mkfile postflight_all TOPSRCDIR=$(TOPSRCDIR) OBJDIR=$(OBJDIR) MOZ_OBJDIR=$(MOZ_OBJDIR); \
	done
else
# OBJDIR refers to the project-specific OBJDIR, which is not available at
# this point when building multiple projects.  Only MOZ_OBJDIR is available.
	set -e; \
	for mkfile in $(MOZ_POSTFLIGHT_ALL); do \
	  $(MAKE) -f $(TOPSRCDIR)/$$mkfile postflight_all TOPSRCDIR=$(TOPSRCDIR) MOZ_OBJDIR=$(MOZ_OBJDIR) MOZ_BUILD_PROJECTS='$(MOZ_BUILD_PROJECTS)'; \
	done
endif
endif

cleansrcdir:
	@cd $(TOPSRCDIR); \
	if [ -f Makefile ]; then \
	  $(MAKE) distclean ; \
	else \
	  echo 'Removing object files from srcdir...'; \
	  rm -fr `find . -type d \( -name .deps -print -o -name CVS \
	          -o -exec test ! -d {}/CVS \; \) -prune \
	          -o \( -name '*.[ao]' -o -name '*.so' \) -type f -print`; \
	   build/autoconf/clean-config.sh; \
	fi;

echo-variable-%:
	@echo $($*)

# This makefile doesn't support parallel execution. It does pass
# MOZ_MAKE_FLAGS to sub-make processes, so they will correctly execute
# in parallel.
.NOTPARALLEL:

.PHONY: checkout co real_checkout build profiledbuild cleansrcdir pull_all build_all clobber clobber_all pull_and_build_all everything configure preflight_all preflight postflight postflight_all $(OBJDIR_TARGETS)
