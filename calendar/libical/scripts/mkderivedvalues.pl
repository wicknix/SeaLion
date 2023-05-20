#!/usr/bin/perl 

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
### END ###
# End of temporary fix.
###

use Getopt::Std;
getopts('chi:');

 #Options
 # c -> generate c code file
 # h-> generate header file   

 # Open with value-types.txt

my %h = read_values_file($ARGV[0]);


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

sub insert_code
{
 # Map type names to the value in the icalvalue_impl data union */

%union_map = (
	      BOOLEAN => 'int',
	      CALADDRESS=>'string',
	      DATE=>'time',
	      DATETIME=>'time',
	      DATETIMEDATE=>'time',
	      DATETIMEPERIOD=>'period',
	      DURATION=>'duration',
	      INTEGER=>'int',
	      TEXT=>'string',
	      URI=>'string',
	      UTCOFFSET=>'int',
	      QUERY=>'string',
	      BINARY=>'string',
	      X=>'string'
	     );


if($opt_h){

  # First print out the value enumerations
  $idx = 5000;
  print "typedef enum icalvalue_kind {\n";
  print "   ICAL_ANY_VALUE=$idx,\n";

  foreach $value  (sort keys %h) {
    
    $idx++;
    my $ucv = join("",map {uc(lc($_));}  split(/-/,$value));
    
    next if $value eq "NO";
    
    print "    ICAL_${ucv}_VALUE=$idx,\n";
  }
  
  $idx++;
  print "   ICAL_NO_VALUE=$idx\n} icalvalue_kind ;\n\n";
  
  # Now create enumerations for property values
  $idx = 10000;
  
  print "#define ICALPROPERTY_FIRST_ENUM $idx\n\n";
  
  foreach $value (sort keys %h) {
    
    next if !$value;
    
    next if $value eq 'NO' or $prop eq 'ANY';

    my $ucv = join("",map {uc(lc($_));}  split(/-/,$value));    
    my @enums = @{$h{$value}->{'enums'}};

    if(@enums){

      my ($c_autogen,$c_type) = @{$h{$value}->{'C'}};
      print "typedef $c_type {\n";
      my $first = 1;

      unshift(@enums,"X");

      push(@enums,"NONE");

      foreach $e (@enums) {
	if (!$first){
	  print ",\n";
	} else {
	  $first = 0;
	}
	
	my $uce = join("",map {uc(lc($_));}  split(/-/,$e));    
	
	print "    ICAL_${ucv}_${uce} = $idx";
	
	$idx++;
      }  

      $c_type =~ s/enum //;

      print "\n} $c_type;\n\n";
    }
  }

  print "#define ICALPROPERTY_LAST_ENUM $idx\n\n";

}


if($opt_c){

  # print out the value to string map

  my $count = scalar(keys %h) + 1;
  print "static const struct icalvalue_kind_map value_map[$count]={\n"; 

  foreach $value  (sort keys %h) {

    $idx++;
    my $ucv = join("",map {uc(lc($_));}  split(/-/,$value));
    
    next if $value eq "NO";
    
    print "    {ICAL_${ucv}_VALUE,\"$value\"},\n";
  }

    
  print "    {ICAL_NO_VALUE,\"\"}\n};";

}


foreach $value  (sort keys %h) {

  my $autogen = $h{$value}->{C}->[0];
  my $type = $h{$value}->{C}->[1];

  my $ucf = join("",map {ucfirst(lc($_));}  split(/-/,$value));
  
  my $lc = lc($ucf);
  my $uc = uc($lc);
  
  my $pointer_check = "icalerror_check_arg_rz( (v!=0),\"v\");\n" if $type =~ /\*/;
  my $pointer_check_rv = "icalerror_check_arg_rv( (v!=0),\"v\");\n" if $type =~ /\*/;
  
  my $assign;
  
  if ($type =~ /char/){
    $assign = "icalmemory_strdup(v);\n\n    if (impl->data.v_string == 0){\n      errno = ENOMEM;\n    }\n";
  } else {
    $assign = "v;";
  }
  
  my $union_data;
  
  if(@{$h{$value}->{'enums'}}){
    $union_data = 'enum';

  } elsif (exists $union_map{$uc} ){
    $union_data=$union_map{$uc};
  } else {
    $union_data = $lc;
  }
  
  if ($opt_c && $autogen) {
    
    print "\n\n\
icalvalue* icalvalue_new_${lc} ($type v){\
   struct icalvalue_impl* impl;\
   $pointer_check\
   impl = icalvalue_new_impl(ICAL_${uc}_VALUE);\
   icalvalue_set_${lc}((icalvalue*)impl,v);\
   return (icalvalue*)impl;\
}\
void icalvalue_set_${lc}(icalvalue* value, $type v) {\
    struct icalvalue_impl* impl; \
    icalerror_check_arg_rv( (value!=0),\"value\");\
    $pointer_check_rv\
    icalerror_check_value_type(value, ICAL_${uc}_VALUE);\
    impl = (struct icalvalue_impl*)value;\n";
    
    if( $union_data eq 'string') {
      
      print "    if(impl->data.v_${union_data}!=0) {free((void*)impl->data.v_${union_data});}\n";
    }
    

    print "\n\
    impl->data.v_$union_data = $assign \n\
    icalvalue_reset_kind(impl);\n}\n";

    print "$type\ icalvalue_get_${lc} (const icalvalue* value) {\n\n";
    if( $union_data eq 'string') {
	print "    icalerror_check_arg_rz ((value!=0),\"value\");\n";
    }
    else {
	print "    icalerror_check_arg ((value!=0),\"value\");\n";
    }
    print "    icalerror_check_value_type (value, ICAL_${uc}_VALUE);\
    return ((struct icalvalue_impl*)value)->data.v_${union_data};\n}\n";

    
  } elsif($opt_h && $autogen) {
    
    print "\n /* $value */ \
icalvalue* icalvalue_new_${lc}($type v); \
$type icalvalue_get_${lc}(const icalvalue* value); \
void icalvalue_set_${lc}(icalvalue* value, ${type} v);\n\n";

  } 

}
  
  
if ($opt_h){
    print "#endif /*ICALVALUE_H*/\n";
  }
  

}
