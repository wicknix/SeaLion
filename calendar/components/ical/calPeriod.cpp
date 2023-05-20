/* -*- Mode: C++; tab-width: 20; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "calPeriod.h"
#include "calBaseCID.h"

#include "nsIClassInfoImpl.h"

#include "calUtils.h"

NS_IMPL_CLASSINFO(calPeriod, nullptr, 0, CAL_PERIOD_CID)
NS_IMPL_ISUPPORTS_CI(calPeriod, calIPeriod, calIPeriodLibical)

calPeriod::calPeriod()
    : mImmutable(false)
{
}

calPeriod::calPeriod(const calPeriod& cpt)
    : mImmutable(false)
{
    if (cpt.mStart) {
        nsCOMPtr<calIDateTime> start;
        cpt.mStart->Clone(getter_AddRefs(start));
        mStart = do_QueryInterface(start);
    }
    if (cpt.mEnd) {
        nsCOMPtr<calIDateTime> end;
        cpt.mEnd->Clone(getter_AddRefs(end));
        mEnd = do_QueryInterface(end);
    }
}

calPeriod::calPeriod(struct icalperiodtype const* aPeriodPtr)
    : mImmutable(false)
{
    FromIcalPeriod(aPeriodPtr);
}

NS_IMETHODIMP
calPeriod::GetIcalPeriod(JS::MutableHandleValue)
{
    return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
calPeriod::SetIcalPeriod(JS::HandleValue)
{
    return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
calPeriod::GetIsMutable(bool *aResult)
{
    NS_ENSURE_ARG_POINTER(aResult);

    *aResult = !mImmutable;
    return NS_OK;
}

NS_IMETHODIMP
calPeriod::MakeImmutable()
{
    mImmutable = true;
    return NS_OK;
}

NS_IMETHODIMP
calPeriod::Clone(calIPeriod **aResult)
{
    NS_ENSURE_ARG_POINTER(aResult);
    calPeriod *cpt = new calPeriod(*this);
    if (!cpt)
        return NS_ERROR_OUT_OF_MEMORY;

    NS_ADDREF(*aResult = cpt);
    return NS_OK;
}


NS_IMETHODIMP calPeriod::GetStart(calIDateTime **_retval)
{
    NS_ENSURE_ARG_POINTER(_retval);
    *_retval = mStart;
    NS_IF_ADDREF(*_retval);
    return NS_OK;
}
NS_IMETHODIMP calPeriod::SetStart(calIDateTime *aValue)
{
    NS_ENSURE_ARG_POINTER(aValue);
    if (mImmutable)
        return NS_ERROR_OBJECT_IS_IMMUTABLE;

    mStart = do_QueryInterface(aValue);
    return mStart->MakeImmutable();
}

NS_IMETHODIMP calPeriod::GetEnd(calIDateTime **_retval)
{
    NS_ENSURE_ARG_POINTER(_retval);
    *_retval = mEnd;
    NS_IF_ADDREF(*_retval);
    return NS_OK;
}
NS_IMETHODIMP calPeriod::SetEnd(calIDateTime *aValue)
{
    NS_ENSURE_ARG_POINTER(aValue);
    if (mImmutable)
        return NS_ERROR_OBJECT_IS_IMMUTABLE;

    mEnd = do_QueryInterface(aValue);
    return mEnd->MakeImmutable();
}

NS_IMETHODIMP calPeriod::GetDuration(calIDuration **_retval)
{
    NS_ENSURE_ARG_POINTER(_retval);
    if (!mStart || !mEnd)
        return NS_ERROR_UNEXPECTED;
    return mEnd->SubtractDate(mStart, _retval);
}

NS_IMETHODIMP
calPeriod::ToString(nsACString& aResult)
{
    return GetIcalString(aResult);
}

NS_IMETHODIMP_(void)
calPeriod::ToIcalPeriod(struct icalperiodtype *icalp)
{
    // makes no sense to create a duration without bath a start and end
    if (!mStart || !mEnd) {
        *icalp = icalperiodtype_null_period();
        return;
    }
    
    mStart->ToIcalTime(&icalp->start);
    mEnd->ToIcalTime(&icalp->end);
}

void
calPeriod::FromIcalPeriod(struct icalperiodtype const* icalp)
{
    mStart = new calDateTime(&(icalp->start), nullptr);
    mStart->MakeImmutable();
    mEnd = new calDateTime(&(icalp->end), nullptr);
    mEnd->MakeImmutable();
    return;
}

NS_IMETHODIMP
calPeriod::GetIcalString(nsACString& aResult)
{
    struct icalperiodtype ip;
    ToIcalPeriod(&ip);
    
    // note that ics is owned by libical, so we don't need to free
    const char *ics = icalperiodtype_as_ical_string(ip);
    
    if (ics) {
        aResult.Assign(ics);
        return NS_OK;
    }

    return NS_ERROR_OUT_OF_MEMORY;
}

NS_IMETHODIMP
calPeriod::SetIcalString(const nsACString& aIcalString)
{
    if (mImmutable)
        return NS_ERROR_OBJECT_IS_IMMUTABLE;
    struct icalperiodtype ip;
    ip = icalperiodtype_from_string(PromiseFlatCString(aIcalString).get());
    //XXX Shortcut. Assumes nobody tried to overrule our impl. of calIDateTime
    mStart = new calDateTime(&ip.start, nullptr);
    if (icaltime_is_null_time(ip.end)) {
        struct icaltimetype end;
        end = icaltime_add(ip.start, ip.duration);
        mEnd = new calDateTime(&end, nullptr);
    } else {
        mEnd = new calDateTime(&ip.end, nullptr);
    }
    return NS_OK;
}
