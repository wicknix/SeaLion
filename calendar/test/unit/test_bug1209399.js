/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calUtils.jsm");

function run_test() {
    // Test handling for multiple double quotes leading/trailing to attendee CN for bug 1209399
    test_newAttendee();
    test_fromICS();
}

function test_newAttendee() {
    let data = [{
        input: { cname: null, id: "mailto:user1@example.net" },
        expected: { cname: null }
    }, {
        input: { cname: "Test2", id: "mailto:user2@example.net" },
        expected: { cname: "Test2" }
    }, {
        input: { cname: '"Test3"', id: "mailto:user3@example.net" },
        expected: { cname: "Test3" }
    }, {
        input: { cname: '""Test4""', id: "mailto:user4@example.net" },
        expected: { cname: "Test4" }
    }, {
        input: { cname: '""Test5"', id: "mailto:user5@example.net" },
        expected: { cname: "Test5" }
    }, {
        input: { cname: '"Test6""', id: "mailto:user6@example.net" },
        expected: { cname: "Test6" }
    }, {
        input: { cname: "", id: "mailto:user7@example.net" },
        expected: { cname: "" }
    }, {
        input: { cname: '""', id: "mailto:user8@example.net" },
        expected: { cname: null }
    }, {
        input: { cname: '""""', id: "mailto:user9@example.net" },
        expected: { cname: null }
    }];

    let i = 0;
    let event = cal.createEvent();
    for (let test of data) {
        i++;
        let attendee = cal.createAttendee();
        attendee.id = test.input.id;
        attendee.commonName = test.input.cname;

        event.addAttendee(attendee);
        let readAttendee = event.getAttendeeById(test.input.id);
        equal(readAttendee.commonName, test.expected.cname,
              "Test #" + i + " for commonName matching of " + test.input.id);
    }
}

function test_fromICS() {
    let ics = [
        "BEGIN:VCALENDAR",
        "PRODID:-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:a84c74d1-cfc6-4ddf-9d60-9e4afd8238cf",
        "SUMMARY:New Event",
        "DTSTART:20150729T103000Z",
        "DTEND:20150729T113000Z",
        "ORGANIZER;RSVP=TRUE;CN=Tester1;PARTSTAT=ACCEPTED;ROLE=CHAIR:mailto:user1@example.net",

        "ATTENDEE;RSVP=TRUE;PARTSTAT=NEEDS-ACTION;CN=Test2;ROLE=REQ-PARTICIPANT:mailto:user2@example.net",
        'ATTENDEE;RSVP=TRUE;PARTSTAT=NEEDS-ACTION;CN="Test3";ROLE=REQ-PARTICIPANT:mailto:user3@example.net',
        'ATTENDEE;RSVP=TRUE;PARTSTAT=NEEDS-ACTION;CN=""Test4"";ROLE=REQ-PARTICIPANT:mailto:user4@example.net',
        "ATTENDEE;RSVP=TRUE;PARTSTAT=NEEDS-ACTION;CN=;ROLE=REQ-PARTICIPANT:mailto:user5@example.net",
        "ATTENDEE;RSVP=TRUE;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT:mailto:user6@example.net",
        'ATTENDEE;RSVP=TRUE;PARTSTAT=NEEDS-ACTION;CN="";ROLE=REQ-PARTICIPANT:mailto:user7@example.net',
        'ATTENDEE;RSVP=TRUE;PARTSTAT=NEEDS-ACTION;CN="""";ROLE=REQ-PARTICIPANT:mailto:user8@example.net',

        "END:VEVENT",
        "END:VCALENDAR"
    ].join("\n");

    let expected = [
        { id: "mailto:user2@example.net", cname: "Test2" },
        { id: "mailto:user3@example.net", cname: "Test3" },
        { id: "mailto:user4@example.net", cname: "" },
        { id: "mailto:user5@example.net", cname: "" },
        { id: "mailto:user6@example.net", cname: null },
        { id: "mailto:user7@example.net", cname: "" },
        { id: "mailto:user8@example.net", cname: "" }
    ];
    let event = createEventFromIcalString(ics);

    equal(event.getAttendees({}).length, expected.length, "Check test consistency");
    for (let exp of expected) {
        let attendee = event.getAttendeeById(exp.id);
        equal(attendee.commonName, exp.cname, "Test for commonName matching of " + exp.id);
    }
}
