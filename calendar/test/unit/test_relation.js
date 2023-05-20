/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function run_test() {
    // Create Relation
    let relation1 = cal.createRelation();

    // Create Items
    let event1 = cal.createEvent();
    let event2 = cal.createEvent();

    // Testing relation set/get.
    let properties = {
        relType: "PARENT",
        relId: event2.id
    };

    for (let [property, value] of Object.entries(properties)) {
        relation1[property] = value;
        equal(relation1[property], value);
    }

    // Add relation to event
    event1.addRelation(relation1);

    // Add 2nd relation to event.
    let relation2 = cal.createRelation();
    relation2.relId = "myid2";
    event1.addRelation(relation2);

    // Check the item functions
    checkRelations(event1, [relation1, relation2]);

    // modify the Relations
    modifyRelations(event1, [relation1, relation2]);

    // test icalproperty
    // eslint-disable-next-line no-unused-expressions
    relation2.icalProperty;

    test_icalprop();
}

function checkRelations(event, expRel) {
    let countObj = {};
    let allRel = event.getRelations(countObj);
    equal(countObj.value, allRel.length);
    equal(allRel.length, expRel.length);

    // check if all expacted relations are found
    for (let i = 0; i < expRel.length; i++) {
        ok(allRel.includes(expRel[i]));
    }

    // Check if all found relations are expected
    for (let i = 0; i < allRel.length; i++) {
        ok(expRel.includes(allRel[i]));
    }
}

function modifyRelations(event, oldRel) {
    let allRel = event.getRelations({});
    let rel = allRel[0];

    // modify the properties
    rel.relType = "SIBLING";
    equal(rel.relType, "SIBLING");
    equal(rel.relType, allRel[0].relType);

    // remove one relation
    event.removeRelation(rel);
    equal(event.getRelations({}).length, oldRel.length - 1);

    // add one relation and remove all relations
    event.addRelation(oldRel[0]);
    event.removeAllRelations();
    equal(event.getRelations({}), 0);
}

function test_icalprop() {
    let rel = cal.createRelation();

    rel.relType = "SIBLING";
    rel.setParameter("X-PROP", "VAL");
    rel.relId = "value";

    let prop = rel.icalProperty;
    let propOrig = rel.icalProperty;

    equal(rel.icalString, prop.icalString);

    equal(prop.value, "value");
    equal(prop.getParameter("X-PROP"), "VAL");
    equal(prop.getParameter("RELTYPE"), "SIBLING");

    prop.value = "changed";
    prop.setParameter("RELTYPE", "changedtype");
    prop.setParameter("X-PROP", "changedxprop");

    equal(rel.relId, "value");
    equal(rel.getParameter("X-PROP"), "VAL");
    equal(rel.relType, "SIBLING");

    rel.icalProperty = prop;

    equal(rel.relId, "changed");
    equal(rel.getParameter("X-PROP"), "changedxprop");
    equal(rel.relType, "changedtype");

    rel.icalString = propOrig.icalString;

    equal(rel.relId, "value");
    equal(rel.getParameter("X-PROP"), "VAL");
    equal(rel.relType, "SIBLING");

    let rel2 = rel.clone();
    rel.icalProperty = prop;

    notEqual(rel.icalString, rel2.icalString);

    rel.deleteParameter("X-PROP");
    equal(rel.icalProperty.getParameter("X-PROP"), null);

    throws(() => {
        rel.icalString = "X-UNKNOWN:value";
    }, /Illegal value/);
}
