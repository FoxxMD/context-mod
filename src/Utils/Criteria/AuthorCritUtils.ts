import {BanCriteria} from "../../Common/Infrastructure/Filters/FilterCriteria";
import {boolToString, testMaybeStringRegex} from "../../util";
import {CMBannedUser} from "../../Common/Infrastructure/Reddit";
import {compareDurationValue, parseDurationComparison} from "../../Common/Infrastructure/Comparisons";
import dayjs from "dayjs";

export const humanizeBanCriteria = (crit: BanCriteria): string => {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(crit)) {
        switch (k.toLowerCase()) {
            case 'note':
                parts.push(`has notes matching: "${Array.isArray(v) ? v.join(' || ') : v}"`);
                break;
            default:
                parts.push(`${k}: ${typeof v === 'boolean' ? boolToString(v) : v.toString()}`);
                break;
        }
    }
    return parts.join(' AND ');
}

export const testBanCriteria = (crit: BanCriteria, banUser: CMBannedUser): boolean => {
    if (crit.permanent !== undefined) {
        // easiest to test for
        if ((banUser.days_left === undefined && !crit.permanent) || (banUser.days_left !== undefined && crit.permanent)) {
            return false;
        }
    }
    if (crit.note !== undefined) {
        let anyPassed = false;
        const expectedValues = Array.isArray(crit.note) ? crit.note : [crit.note];
        for (const expectedVal of expectedValues) {
            try {
                const [regPassed] = testMaybeStringRegex(expectedVal, banUser.note);
                if (regPassed) {
                    anyPassed = true;
                }
            } catch (err: any) {
                if (err.message.includes('Could not convert test value')) {
                    // fallback to simple comparison
                    anyPassed = expectedVal.toLowerCase() === banUser.note.toLowerCase();
                } else {
                    throw err;
                }
            }
            if (anyPassed) {
                break;
            }
        }
        if (!anyPassed) {
            return false;
        }
    }

    if (crit.bannedAt !== undefined) {
        const ageTest = compareDurationValue(parseDurationComparison(crit.bannedAt), banUser.date);
        if (!ageTest) {
            return false;
        }
    }

    if (crit.daysLeft !== undefined) {
        const daysLeftCompare = parseDurationComparison(crit.daysLeft);
        if (banUser.days_left === undefined) {
            if (daysLeftCompare.operator.includes('<')) {
                // permaban, will never be less than some finite duration
                return false;
            }
            // otherwise will always pass since any finite duration is less than infinity
        } else {
            const dayTest = compareDurationValue(daysLeftCompare, dayjs().add(banUser.days_left));
            if (!dayTest) {
                return false;
            }
        }
    }

    return true;
}
