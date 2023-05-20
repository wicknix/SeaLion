/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function run_test() {
    do_test_pending();
    cal.getTimezoneService().startup({
        onResult: function() {
            really_run_test();
            do_test_finished();
        }
    });
}

function really_run_test() {
    let event = cal.createEvent();

    let str =
         ["BEGIN:VCALENDAR",
          "PRODID:-//RDU Software//NONSGML HandCal//EN",
          "VERSION:2.0",
          "BEGIN:VTIMEZONE",
          "TZID:America/New_York",
          "BEGIN:STANDARD",
          "DTSTART:19981025T020000",
          "TZOFFSETFROM:-0400",
          "TZOFFSETTO:-0500",
          "TZNAME:EST",
          "END:STANDARD",
          "BEGIN:DAYLIGHT",
          "DTSTART:19990404T020000",
          "TZOFFSETFROM:-0500",
          "TZOFFSETTO:-0400",
          "TZNAME:EDT",
          "END:DAYLIGHT",
          "END:VTIMEZONE",
          "BEGIN:VEVENT",
          "DTSTAMP:19980309T231000Z",
          "UID:guid-1.example.com",
          "ORGANIZER:mailto:mrbig@example.com",
          "ATTENDEE;RSVP=TRUE;ROLE=REQ-PARTICIPANT;CUTYPE=GROUP:",
          " mailto:employee-A@example.com",
          "DESCRIPTION:Project XYZ Review Meeting",
          "CATEGORIES:MEETING",
          "CLASS:PUBLIC",
          "CREATED:19980309T130000Z",
          "SUMMARY:XYZ Project Review",
          "DTSTART;TZID=America/New_York:19980312T083000",
          "DTEND;TZID=America/New_York:19980312T093000",
          "LOCATION:1CP Conference Room 4350",
          "END:VEVENT",
          "END:VCALENDAR",
          ""].join("\r\n");

    let strTz =
         ["BEGIN:VTIMEZONE",
          "TZID:America/New_York",
          "BEGIN:STANDARD",
          "DTSTART:19981025T020000",
          "TZOFFSETFROM:-0400",
          "TZOFFSETTO:-0500",
          "TZNAME:EST",
          "END:STANDARD",
          "BEGIN:DAYLIGHT",
          "DTSTART:19990404T020000",
          "TZOFFSETFROM:-0500",
          "TZOFFSETTO:-0400",
          "TZNAME:EDT",
          "END:DAYLIGHT",
          "END:VTIMEZONE",
          ""].join("\r\n");

    let tzs = cal.getTimezoneService();

    event.icalString = str;

    let startDate = event.startDate;
    let endDate = event.endDate;

    startDate.timezone = tzs.getTimezone(startDate.timezone.tzid);
    endDate.timezone = tzs.getTimezone(endDate.timezone.tzid);
    notEqual(strTz, startDate.timezone.toString());
}
