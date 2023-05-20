/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calHashedArray.jsm");

function run_test() {
    test_array_base();
    test_array_sorted();
    test_hashAccessor();
}

/**
 * Helper function to create an item that has a sensible hash id, with the given
 * title identification.
 *
 * @param ident     The title to identify the item.
 * @return          The created item.
 */
function hashedCreateItem(ident) {
    let item = cal.createEvent();
    item.calendar = { id: "test" };
    item.id = cal.getUUID();
    item.title = ident;
    return item;
}

/**
 * Comparator function to sort the items by their title
 *
 * @param a         Object to compare.
 * @param b         Object to compare with.
 * @return          0, -1, or 1 (usual comptor meanings)
 */
function titleComptor(a, b) {
    if (a.title > b.title) {
        return 1;
    } else if (a.title < b.title) {
        return -1;
    } else {
        return 0;
    }
}

/**
 * Checks if the hashed array accessor functions work for the status of the
 * items array.
 *
 * @param har           The Hashed Array
 * @param testItems     The array of test items
 * @param itemAccessor  The accessor func to retrieve the items
 * @throws Exception    If the arrays are not the same.
 */
function checkConsistancy(har, testItems, itemAccessor) {
    itemAccessor = itemAccessor || function(item) { return item; };
    for (let idx in testItems) {
        let testItem = itemAccessor(testItems[idx]);
        equal(itemAccessor(har.itemByIndex(idx)).title,
                    testItem.title);
        equal(itemAccessor(har.itemById(testItem.hashId)).title,
                    testItem.title);
        equal(har.indexOf(testItems[idx]), idx);
    }
}

/**
 * Man, this function is really hard to keep general enough, I'm almost tempted
 * to duplicate the code. It checks if the remove and modify operations work for
 * the given hashed array.
 *
 * @param har               The Hashed Array
 * @param testItems         The js array with the items
 * @param postprocessFunc   (optional) The function to call after each
 *                            operation, but before checking consistancy.
 * @param itemAccessor      (optional) The function to access the item for an
 *                            array element.
 * @param itemCreator       (optional) Function to create a new item for the
 *                            array.
 */
function testRemoveModify(har, testItems, postprocessFunc, itemAccessor, itemCreator) {
    postprocessFunc = postprocessFunc || function(a, b) { return [a, b]; };
    itemCreator = itemCreator || (title => hashedCreateItem(title));
    itemAccessor = itemAccessor || function(item) { return item; };

    // Now, delete the second item and check again
    har.removeById(itemAccessor(testItems[1]).hashId);
    testItems.splice(1, 1);
    [har, testItems] = postprocessFunc(har, testItems);

    checkConsistancy(har, testItems, itemAccessor);

    // Try the same by index
    har.removeByIndex(2);
    testItems.splice(2, 1);
    [har, testItems] = postprocessFunc(har, testItems);
    checkConsistancy(har, testItems, itemAccessor);

    // Try modifying an item
    let newInstance = itemCreator("z-changed");
    itemAccessor(newInstance).id = itemAccessor(testItems[0]).id;
    testItems[0] = newInstance;
    har.modifyItem(newInstance);
    [har, testItems] = postprocessFunc(har, testItems);
    checkConsistancy(har, testItems, itemAccessor);
}

/**
 * Tests the basic cal.HashedArray
 */
function test_array_base() {
    let har, testItems;

    // Test normal additions
    har = new cal.HashedArray();
    testItems = ["a", "b", "c", "d"].map(hashedCreateItem);

    testItems.forEach(har.addItem, har);
    checkConsistancy(har, testItems);
    testRemoveModify(har, testItems);

    // Test adding in batch mode
    har = new cal.HashedArray();
    testItems = ["e", "f", "g", "h"].map(hashedCreateItem);
    har.startBatch();
    testItems.forEach(har.addItem, har);
    har.endBatch();
    checkConsistancy(har, testItems);
    testRemoveModify(har, testItems);
}

/**
 * Tests the sorted cal.SortedHashedArray
 */
function test_array_sorted() {
    let har, testItems, testItemsSorted;

    function sortedPostProcess(harParam, tiParam) {
        tiParam = tiParam.sort(titleComptor);
        return [harParam, tiParam];
    }

    // Test normal additions
    har = new cal.SortedHashedArray(titleComptor);
    testItems = ["d", "c", "a", "b"].map(hashedCreateItem);
    testItemsSorted = testItems.sort(titleComptor);

    testItems.forEach(har.addItem, har);
    checkConsistancy(har, testItemsSorted);
    testRemoveModify(har, testItemsSorted, sortedPostProcess);

    // Test adding in batch mode
    har = new cal.SortedHashedArray(titleComptor);
    testItems = ["e", "f", "g", "h"].map(hashedCreateItem);
    testItemsSorted = testItems.sort(titleComptor);
    har.startBatch();
    testItems.forEach(har.addItem, har);
    har.endBatch();
    checkConsistancy(har, testItemsSorted);
    testRemoveModify(har, testItemsSorted, sortedPostProcess);
}

/**
 * Tests cal.SortedHashedArray with a custom hashAccessor.
 */
function test_hashAccessor() {
    let har, testItems, testItemsSorted;
    let comptor = (a, b) => titleComptor(a.item, b.item);

    har = new cal.SortedHashedArray(comptor);
    har.hashAccessor = function(obj) {
        return obj.item.hashId;
    };

    function itemAccessor(obj) {
        if (!obj) {
            do_throw("WTF?");
        }
        return obj.item;
    }

    function itemCreator(title) {
        return { item: hashedCreateItem(title) };
    }

    function sortedPostProcess(harParam, tiParam) {
        tiParam = tiParam.sort(comptor);
        return [harParam, tiParam];
    }

    testItems = ["d", "c", "a", "b"].map(itemCreator);

    testItemsSorted = testItems.sort(comptor);
    testItems.forEach(har.addItem, har);
    checkConsistancy(har, testItemsSorted, itemAccessor);
    testRemoveModify(har, testItemsSorted, sortedPostProcess, itemAccessor, itemCreator);
}
