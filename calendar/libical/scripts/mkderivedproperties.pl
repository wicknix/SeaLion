#!/usr/bin/env perl

### START ###
# Copied from readvaluesfile.pl as a temporary fix due to perl problems (Bug 1259090).
###
sub read_values_file {

  my $path = shift;
  my %h;

  open(F,$path) || die "Can't open values file $path";

  while(<F>){

    chop;

    s/#.*$//g;
    s/\"//g;
    s/\r//g;

    next if ! $_;

    @column = split(/,/,$_);

    my $value_name = $column[0];

    my $c_type_str =  $column[1];
    my $c_autogen = ($c_type_str =~ /\(a\)/);

    my $c_type = $c_type_str;
    $c_type =~ s/\(.\)//;

    my $python_type =  $column[2];
    my $components = $column[3];
    my $enum_values = $column[4];

    my @components;
    if($components ne "unitary"){
      @components = split(/;/,$components);
    } else {
      @components = ();
    }

    my @enums;
    if($enum_values) {
      @enums  = split(/;/,$enum_values);

    } else {
      @enums = ();
    }

    $h{$value_name} = { C => [$c_autogen,$c_type],
      perl => $perl_type,
      python => $python_type,
      components=>[@components],
      enums=>[@enums]
    };
  }

  return %h;
}

sub read_properties_file {

  my $path = shift;
  my %h;

  open(F,$path) || die "Can't open properties file $path";

  while(<F>){

    chop;

    s/#.*$//g;
    s/\"//g;
    s/\r//g;

    next if ! $_;

    @column = split(/,/,$_);

    my $property_name = $column[0];

    my $lic_value = $column[1];
    my $default_value = $column[2];

    $h{$property_name} = { lic_value => $lic_value,
       default_value => $default_value
    };
  }

  return %h;
}
### END ###
# End of temporary fix.
###

use Getopt::Std;
getopts('chspmi:');

# ARG 0 is properties.csv
%propmap  = read_properties_file($ARGV[0]);

# ARG 1 is value-types.txt
%valuemap  = read_values_file($ARGV[1]);


$include_vanew = 1;

# Write the file inline by copying everything before a demarcation
# line, and putting the generated data after the demarcation

if ($opt_i) {

  open(IN,$opt_i) || die "Can't open input file $opt_i";

  while(<IN>){

    if (/<insert_code_here>/){
      insert_code();
    } else {
      print;
   }
 
  }    
 
}

sub fudge_data {
  my $prop = shift;

  my $value = $propmap{$prop}->{'lic_value'};

  if (!$value){
    die "Can't find value for property \"$prop\"\n";
  }
  my $ucf = join("",map {ucfirst(lc($_));}  split(/-/,$prop));
  my $lc = lc($ucf);
  my $uc = uc($lc);

  my $ucfvalue = join("",map {ucfirst(lc($_));}  split(/-/,$value));
  my $lcvalue = lc($ucfvalue);
  my $ucvalue = uc($lcvalue);

  my $type = $valuemap{$value}->{C}->[1];

  return ($uc,$lc,$lcvalue,$ucvalue,$type);

}  

sub insert_code {

# Create the property map data
if($opt_c){


  my @props = sort keys %propmap;
  my $count = scalar(@props);
  

  print "static const struct icalproperty_map property_map[$count] = {\n";
  
  foreach $prop (@props) {
    
    next if !$prop;
    
    next if $prop eq 'NO';
    
    my ($uc,$lc,$lcvalue,$ucvalue,$type) = fudge_data($prop);
    
    print "{ICAL_${uc}_PROPERTY,\"$prop\",ICAL_${ucvalue}_VALUE},\n";
    
  }
  
  $prop = "NO";
  
  my ($uc,$lc,$lcvalue,$ucvalue,$type) = fudge_data($prop);
  
  print "{ICAL_${uc}_PROPERTY,\"\",ICAL_NO_VALUE}};\n\n";

  $idx = 10000;
  $count = 1;
  my $out = "";

  foreach $value (sort keys %valuemap) {
    
    next if !$value;    
    next if $value eq 'NO' or $prop eq 'ANY';

    my $ucv = join("",map {uc(lc($_));}  split(/-/,$value));    
    my @enums = @{$valuemap{$value}->{'enums'}};

    if(@enums){

      my ($c_autogen,$c_type) = @{$valuemap{$value}->{'C'}};
      
      unshift(@enums,"X");
      push(@enums,"NONE");

      foreach $e (@enums) {

	my $uce = join("",map {uc(lc($_));}  split(/-/,$e));
	
	if($e ne "X" and $e ne "NONE"){
	  $str = $e;
	} else {
	  $str = "";
	}

	$out.="    {ICAL_${ucv}_PROPERTY,ICAL_${ucv}_${uce},\"$str\" }, /*$idx*/\n";

	$idx++;
	$count++;
      }
      
    }
  }

  $count++;
  print "static const struct icalproperty_enum_map enum_map[$count] = {\n";
  print $out;
  print "    {ICAL_NO_PROPERTY,0,\"\"}\n};\n\n";
  


}


if($opt_h){

  # Create the property enumerations list
  print "typedef enum icalproperty_kind {\n    ICAL_ANY_PROPERTY = 0,\n";
  foreach $prop (sort keys %propmap) {
    
    next if !$prop;
    
    next if $prop eq 'NO' or $prop eq 'ANY';
    
    my ($uc,$lc,$lcvalue,$ucvalue,$type) = fudge_data($prop);
    
    print "    ICAL_${uc}_PROPERTY, \n";
    
  }  
  print "    ICAL_NO_PROPERTY\n} icalproperty_kind;\n\n";


}


foreach $prop (sort keys %propmap) {

  next if !$prop;

  next if $prop eq 'NO' or $prop eq 'ANY';

  my ($uc,$lc,$lcvalue,$ucvalue,$type) = fudge_data($prop);

  
  my $pointer_check;
  if ($type =~ /\*/){
    $pointer_check = "icalerror_check_arg_rz( (v!=0),\"v\");\n" if $type =~ /\*/;
  } elsif ( $type eq "void" ){
    $pointer_check = "icalerror_check_arg_rv( (v!=0),\"v\");\n" if $type =~ /\*/;

  }    

  my $set_pointer_check = "icalerror_check_arg_rv( (v!=0),\"v\");\n" if $type =~ /\*/;

  if($opt_c) { # Generate C source

   if ($include_vanew) {
     print<<EOM;
icalproperty* icalproperty_vanew_${lc}($type v, ...){
   va_list args;
   struct icalproperty_impl *impl;
   $pointer_check
   impl= icalproperty_new_impl(ICAL_${uc}_PROPERTY);
   icalproperty_set_${lc}((icalproperty*)impl,v);
   va_start(args,v);
   icalproperty_add_parameters(impl, args);
   va_end(args);
   return (icalproperty*)impl;
}
EOM
}
	print<<EOM;

/* $prop */
icalproperty* icalproperty_new_${lc}($type v) {
   struct icalproperty_impl *impl;
   $pointer_check
   impl = icalproperty_new_impl(ICAL_${uc}_PROPERTY);
   icalproperty_set_${lc}((icalproperty*)impl,v);
   return (icalproperty*)impl;
}

EOM
    # Allow DTSTART, DTEND, DUE, EXDATE and RECURRENCE-ID to take DATE values.
    if ($lc eq "dtstart" || $lc eq "dtend" || $lc eq "due" || $lc eq "exdate"
	|| $lc eq "recurrenceid") {
	print<<EOM;
void icalproperty_set_${lc}(icalproperty* prop, $type v){
    icalvalue *value;
    $set_pointer_check
    icalerror_check_arg_rv( (prop!=0),"prop");
    if (v.is_date)
        value = icalvalue_new_date(v);
    else
        value = icalvalue_new_datetime(v);
    icalproperty_set_value(prop,value);
}
EOM
    } else {

	print<<EOM;
void icalproperty_set_${lc}(icalproperty* prop, $type v){
    $set_pointer_check
    icalerror_check_arg_rv( (prop!=0),"prop");
    icalproperty_set_value(prop,icalvalue_new_${lcvalue}(v));
}
EOM
	}
# Dirk Theisen pointed out, exdate needs to match TZID parameters in EXDATE
    if ($lc eq "exdate") {
	print<<EOM;
$type icalproperty_get_${lc}(const icalproperty* prop){
	icalerror_check_arg( (prop!=0),"prop");
#ifndef _MSC_VER
        /*
	 * Code by dirk\@objectpark.net:
	 * Set the time zone manually. I am really puzzled that 
	 * it doesnot work automatically like in the other functions 
	 * like icalproperty_get_dtstart().
	 */
	struct icaltimetype itt =
		icalvalue_get_datetime(icalproperty_get_value(prop));
	icalparameter* param = icalproperty_get_first_parameter(prop,
								ICAL_TZID_PARAMETER);
	if (param) {
	        const icaltimezone *zone =
		        icaltimezone_get_builtin_timezone(icalparameter_get_tzid(param));
		icaltime_set_timezone(&itt, zone);
        }
	return itt;
#else
    return icalvalue_get_datetime(icalproperty_get_value(prop));
#endif
}
EOM
    } else {
	print<<EOM;
$type icalproperty_get_${lc}(const icalproperty* prop){
    icalerror_check_arg( (prop!=0),"prop");
    return icalvalue_get_${lcvalue}(icalproperty_get_value(prop));
}
EOM
    }
  } elsif ($opt_h) { # Generate C Header file


 print "\
/* $prop */\
icalproperty* icalproperty_new_${lc}($type v);\
void icalproperty_set_${lc}(icalproperty* prop, $type v);\
$type icalproperty_get_${lc}(const icalproperty* prop);";
  

if ($include_vanew){
  print "icalproperty* icalproperty_vanew_${lc}($type v, ...);\n";
}

} 


} # This brace terminates the main loop



if ($opt_h){

print "\n\n#endif /*ICALPROPERTY_H*/\n"
}

}
