/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource:///modules/iteratorUtils.jsm");

function run_test() {
    test_values();
    test_serialize();
    test_properties();
    test_doubleParameters(); // Bug 875739
}

function test_values() {
    function findAttendeesInResults(event, expectedAttendees) {
        let countObj = {};
        // Getting all attendees
        let allAttendees = event.getAttendees(countObj);
        equal(countObj.value, allAttendees.length);

        equal(allAttendees.length, expectedAttendees.length);

        // Check if all expected attendees are found
        for (let i = 0; i < expectedAttendees.length; i++) {
            ok(allAttendees.includes(expectedAttendees[i]));
        }

        // Check if all found attendees are expected
        for (let i = 0; i < allAttendees.length; i++) {
            ok(expectedAttendees.includes(allAttendees[i]));
        }
    }
    function findById(event, id, a) {
        let foundAttendee = event.getAttendeeById(id);
        equal(foundAttendee, a);
    }
    function testImmutability(a, properties) {
        ok(!a.isMutable);
        // Check if setting a property throws. It should.
        for (let i = 0; i < properties.length; i++) {
            let old = a[properties[i]];
            throws(() => {
                a[properties[i]] = old + 1;
            }, /Can not modify immutable data container/);

            equal(a[properties[i]], old);
        }
    }

    // Create Attendee
    let attendee1 = cal.createAttendee();
    // Testing attendee set/get.
    let properties = ["id", "commonName", "rsvp", "role", "participationStatus",
                      "userType"];
    let values = ["myid", "mycn", "TRUE", "CHAIR", "DECLINED", "RESOURCE"];
    // Make sure test is valid
    equal(properties.length, values.length);

    for (let i = 0; i < properties.length; i++) {
        attendee1[properties[i]] = values[i];
        equal(attendee1[properties[i]], values[i]);
    }

    // Create event
    let event = cal.createEvent();

    // Add attendee to event
    event.addAttendee(attendee1);

    // Add 2nd attendee to event.
    let attendee2 = cal.createAttendee();
    attendee2.id = "myid2";
    event.addAttendee(attendee2);

    // Finding by ID
    findById(event, "myid", attendee1);
    findById(event, "myid2", attendee2);

    findAttendeesInResults(event, [attendee1, attendee2]);

    // Making attendee immutable
    attendee1.makeImmutable();
    testImmutability(attendee1, properties);
    // Testing cascaded immutability (event -> attendee)
    event.makeImmutable();
    testImmutability(attendee2, properties);

    // Testing cloning
    let eventClone = event.clone();
    let clonedatts = eventClone.getAttendees({});
    let atts = event.getAttendees({});
    equal(atts.length, clonedatts.length);

    for (let i = 0; i < clonedatts.length; i++) {
        // The attributes should not be equal
        notEqual(atts[i], clonedatts[i]);
        // But the ids should
        equal(atts[i].id, clonedatts[i].id);
    }

    // Make sure organizers are also cloned correctly
    let attendee3 = cal.createAttendee();
    attendee3.id = "horst";
    attendee3.isOrganizer = true;
    let attendee4 = attendee3.clone();

    ok(attendee4.isOrganizer);
    attendee3.isOrganizer = false;
    ok(attendee4.isOrganizer);
}

function test_serialize() {
    let a = cal.createAttendee();

    throws(() => {
        // eslint-disable-next-line no-unused-expressions
        a.icalProperty;
    }, /Component not initialized/);

    a.id = "horst";
    a.commonName = "Horst";
    a.rsvp = "TRUE";

    a.isOrganizer = false;

    a.role = "CHAIR";
    a.participationStatus = "DECLINED";
    a.userType = "RESOURCE";

    a.setProperty("X-NAME", "X-VALUE");

    let prop = a.icalProperty;
    dump(prop.icalString);
    equal(prop.value, "horst");
    equal(prop.propertyName, "ATTENDEE");
    equal(prop.getParameter("CN"), "Horst");
    equal(prop.getParameter("RSVP"), "TRUE");
    equal(prop.getParameter("ROLE"), "CHAIR");
    equal(prop.getParameter("PARTSTAT"), "DECLINED");
    equal(prop.getParameter("CUTYPE"), "RESOURCE");
    equal(prop.getParameter("X-NAME"), "X-VALUE");

    a.isOrganizer = true;
    prop = a.icalProperty;
    equal(prop.value, "horst");
    equal(prop.propertyName, "ORGANIZER");
    equal(prop.getParameter("CN"), "Horst");
    equal(prop.getParameter("RSVP"), "TRUE");
    equal(prop.getParameter("ROLE"), "CHAIR");
    equal(prop.getParameter("PARTSTAT"), "DECLINED");
    equal(prop.getParameter("CUTYPE"), "RESOURCE");
    equal(prop.getParameter("X-NAME"), "X-VALUE");
}

function test_properties() {
    let a = cal.createAttendee();

    throws(() => {
        // eslint-disable-next-line no-unused-expressions
        a.icalProperty;
    }, /Component not initialized/);

    a.id = "horst";
    a.commonName = "Horst";
    a.rsvp = "TRUE";

    a.isOrganizer = false;

    a.role = "CHAIR";
    a.participationStatus = "DECLINED";
    a.userType = "RESOURCE";

    // Only X-Props should show up in the enumerator
    a.setProperty("X-NAME", "X-VALUE");
    for (let x in fixIterator(a.propertyEnumerator, Components.interfaces.nsIProperty)) {
        equal(x.name, "X-NAME");
        equal(x.value, "X-VALUE");
    }

    a.deleteProperty("X-NAME");
    for (let x in fixIterator(a.propertyEnumerator, Components.interfaces.nsIProperty)) {
        do_throw("Unexpected property " + x.name + " = " + x.value);
    }

    a.setProperty("X-NAME", "X-VALUE");
    a.setProperty("X-NAME", null);

    for (let x in fixIterator(a.propertyEnumerator, Components.interfaces.nsIProperty)) {
        do_throw("Unexpected property after setting null " + x.name + " = " + x.value);
    }
}

function test_doubleParameters() {
    function testParameters(aAttendees, aExpected) {
        for (let attendee of aAttendees) {
            let prop = attendee.icalProperty;
            let parNames = [];
            let parValues = [];

            // Extract the parameters
            for (let paramName = prop.getFirstParameterName();
                 paramName;
                 paramName = prop.getNextParameterName()) {
                parNames.push(paramName);
                parValues.push(prop.getParameter(paramName));
            }

            // Check the results
            let att_n = attendee.id.substr(7, 9);
            for (let parIndex in parNames) {
                ok(aExpected[att_n].param.includes(parNames[parIndex]),
                   "Parameter " + parNames[parIndex] + " included in " + att_n);
                ok(aExpected[att_n].values.includes(parValues[parIndex]),
                   "Value " + parValues[parIndex] + " for parameter " + parNames[parIndex]);
            }
            ok(parNames.length == aExpected[att_n].param.length,
               "Each parameter has been considered for " + att_n);
        }
    }

    // Event with attendees and organizer with one of the parameter duplicated.
    let ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Marketcircle Inc.//Daylite 4.0//EN",
        "BEGIN:VEVENT",
        "DTSTART:20130529T100000",
        "DTEND:20130529T110000",
        "SUMMARY:Summary",
        "CREATED:20130514T124220Z",
        "DTSTAMP:20130524T101307Z",
        "UID:9482DDFA-07B4-44B9-8228-ED4BC17BA278",
        "SEQUENCE:3",
        "ORGANIZER;CN=CN_organizer;X-ORACLE-GUID=A5120D71D6193E11E04400144F;",
        " X-UW-AVAILABLE-APPOINTMENT-ROLE=OWNER;X-UW-AVAILABLE-APPOINTMENT",
        " -ROLE=OWNER:mailto:organizer@example.com",
        "ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE;CUTYPE=INDIVIDUAL;RSVP=TRUE;",
        " PARTSTAT=NEEDS-ACTION;X-RECEIVED-DTSTAMP=",
        " 20130827T124944Z;CN=CN_attendee1:mailto:attendee1@example.com",
        "ATTENDEE;ROLE=CHAIR;CN=CN_attendee2;CUTYPE=INDIVIDUAL;",
        " PARTSTAT=ACCEPTED;CN=CN_attendee2:mailto:attendee2@example.com",
        "ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE;CUTYPE=RESOURCE;",
        " PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT;CN=CN_attendee3",
        " :mailto:attendee3@example.com",
        'ATTENDEE;CN="CN_attendee4";PARTSTAT=ACCEPTED;X-RECEIVED-DTSTAMP=',
        " 20130827T124944Z;X-RECEIVED-SEQUENCE=0;X-RECEIVED-SEQUENCE=0",
        " :mailto:attendee4@example.com",
        "END:VEVENT",
        "END:VCALENDAR"
    ].join("\n");

    let expectedOrganizer = {
        organizer: {
            param:  ["CN", "X-ORACLE-GUID", "X-UW-AVAILABLE-APPOINTMENT-ROLE"],
            values: ["CN_organizer", "A5120D71D6193E11E04400144F", "OWNER"]
        }
    };
    let expectedAttendee = {
        attendee1: {
            param:  ["CN", "RSVP", "ROLE", "PARTSTAT", "CUTYPE", "X-RECEIVED-DTSTAMP"],
            values: ["CN_attendee1", "TRUE", "REQ-PARTICIPANT", "NEEDS-ACTION", "INDIVIDUAL", "20130827T124944Z"]
        },
        attendee2: {
            param:  ["CN", "ROLE", "PARTSTAT", "CUTYPE"],
            values: ["CN_attendee2", "CHAIR", "ACCEPTED", "INDIVIDUAL"]
        },
        attendee3: {
            param:  ["CN", "RSVP", "ROLE", "PARTSTAT", "CUTYPE"],
            values: ["CN_attendee3", "TRUE", "REQ-PARTICIPANT", "NEEDS-ACTION", "RESOURCE"]
        },
        attendee4: {
            param:  ["CN", "PARTSTAT", "X-RECEIVED-DTSTAMP", "X-RECEIVED-SEQUENCE"],
            values: ["CN_attendee4", "ACCEPTED", "20130827T124944Z", "0"]
        }
    };

    let event = createEventFromIcalString(ics);
    let organizer = [event.organizer];
    let attendees = event.getAttendees({});

    testParameters(organizer, expectedOrganizer);
    testParameters(attendees, expectedAttendee);
}
