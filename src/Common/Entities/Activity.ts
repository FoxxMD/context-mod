import {Entity, Column, ManyToOne, PrimaryColumn, OneToMany, Index} from "typeorm";
import {AuthorEntity} from "./AuthorEntity";
import {Subreddit} from "./Subreddit";
import {CMEvent} from "./CMEvent";
import {asComment, getActivityAuthorName, parseRedditFullname, redditThingTypeToPrefix} from "../../util";
import {activityReports, ActivityType, Report, SnoowrapActivity} from "../Infrastructure/Reddit";
import {ActivityReport} from "./ActivityReport";
import dayjs, {Dayjs} from "dayjs";

export interface ActivityEntityOptions {
    id: string
    subreddit: Subreddit
    type: ActivityType
    content: string
    permalink: string
    author: AuthorEntity
    submission?: Activity
    reports?: ActivityReport[]
}

@Entity()
@Index(['name', 'type'], {unique: true})
export class Activity {

    @PrimaryColumn({name: 'id', comment: 'A reddit fullname -- includes prefix'})
    _id!: string;

    set id(data: string) {
        const thing = parseRedditFullname(data);
        if(thing !== undefined) {
            this._id = thing.val;
            this.type = thing.type as ActivityType
            this.name = thing.id;
        } else if(this.type !== undefined) {
            // assuming we accidentally used the non-prefixed id
            this._id = `${redditThingTypeToPrefix(this.type)}_${data}`;
            this.name = data;
        }
    }

    get id() {
        return this._id;
    }

    @Column({name: 'name'})
    name!: string;

    @ManyToOne(type => Subreddit, sub => sub.activities, {cascade: ['insert']})
    subreddit!: Subreddit;

    @Column("varchar", {length: 20})
    type!: ActivityType

    @Column("text")
    content!: string;

    @Index({unique: true})
    @Column("text")
    permalink!: string;

    @ManyToOne(type => AuthorEntity, author => author.activities, {cascade: ['insert']})
    author!: AuthorEntity;

    @OneToMany(type => CMEvent, act => act.activity) // note: we will create author property in the Photo class below
    actionedEvents!: CMEvent[]

    @ManyToOne(type => Activity, obj => obj.comments, {nullable: true})
    submission?: Activity;

    @OneToMany(type => Activity, obj => obj.submission, {nullable: true})
    comments!: Activity[];

    @OneToMany(type => ActivityReport, act => act.activity, {cascade: ['insert'], eager: true})
    reports: ActivityReport[] | undefined

    constructor(data?: ActivityEntityOptions) {
        if(data !== undefined) {
            this.type = data.type;
            this.id = data.id;
            this.subreddit = data.subreddit;
            this.content = data.content;
            this.permalink = data.permalink;
            this.author = data.author;
            this.submission = data.submission;
            this.reports = data.reports !== undefined ? data.reports : undefined;
        }
    }

    /**
     * @param {SnoowrapActivity} activity
     * @param {Dayjs|undefined} lastKnownStateTimestamp Override the last good state (useful when tracked through polling)
     * */
    syncReports(activity: SnoowrapActivity, lastKnownStateTimestamp?: Dayjs) {
        if(activity.num_reports > 0 && (this.reports === undefined || activity.num_reports !== this.reports.length)) {
            if(this.reports === undefined) {
                this.reports = [];
            }
            const reports = activityReports(activity);
            // match up existing reports
            const usedReportEntities: string[] = [];
            const unsyncedReports: Report[] = [];
            for(const r of reports) {
                const matchedEntity = this.reports.find(x => !usedReportEntities.includes(x.id) && x.matchReport(r));
                if(matchedEntity !== undefined) {
                    usedReportEntities.push(matchedEntity.id);
                } else {
                    // found an unsynced report
                    unsyncedReports.push(r);
                }
            }

            // ideally we only have one report but it's possible (probable) there are more
            //
            // to simplify tracking over time we will spread out the "create time" for each report to be between NOW
            // and the last recorded report, or if no reports then the create time of the activity

            // -- the assumptions about tracking should be good enough for most users because:
            // * default poll interval is 30 seconds so even if there are more than one reports in that time the resolution is high enough for accurate usage (most mods will use "> 1 report in 1 minute" or larger timescales)
            // * for populating existing reports (CM has not been tracking since activity creation) we don't want to bunch up all reports at the timestamp which could create false positives,
            //   it's more likely that reports would be spread out than all occurring at the same time.

            // TODO additionally, will allow users to specify minimum required granularity to use when filtering by reports over time

            let lastRecordedTime = lastKnownStateTimestamp;
            if(lastKnownStateTimestamp === undefined) {
                lastRecordedTime = this.reports.length > 0 ?
                    // get the latest create date for existing reports
                    this.reports.reduce((acc, curr) => curr.createdAt.isAfter(acc) ? curr.createdAt : acc, dayjs('2000-1-1'))
                    // if no reports then use activity create date
                    : dayjs(activity.created_utc * 1000);
            }

            // find the amount of time between now and last good timestamp
            const missingTimespan = dayjs.duration(dayjs().diff(lastRecordedTime));
            const granularity = Math.floor(missingTimespan.asSeconds());

            // each report will have its create date spaced out (mostly) equally between now and the last good timestamp
            //
            // if only one report stick it in exact middle
            // if more than one than decrease span by 1/4 so that we don't end up having reports dead-on the last timestamp
            const increment = Math.floor(unsyncedReports.length === 1 ? (granularity / 2) : ((granularity / 1.25) / unsyncedReports.length));

            for(let i = 0; i < unsyncedReports.length; i++) {
               const r = new ActivityReport({...unsyncedReports[i], activity: this, granularity});
               r.createdAt = dayjs().subtract(increment * (i + 1), 'seconds');
               this.reports.push(r);
            }

            return true;
        }
        return false;
    }

    static fromSnoowrapActivity(subreddit: Subreddit, activity: SnoowrapActivity, lastKnownStateTimestamp?: dayjs.Dayjs | undefined) {
        let submission: Activity | undefined;
        let type: ActivityType = 'submission';
        let content: string;
        if(asComment(activity)) {
            type = 'comment';
            content = activity.body;
            submission = new Activity();
            submission.type = 'submission';
            submission.id = activity.link_id;
            submission.subreddit = subreddit;
        } else {
            content = activity.title;
        }

        const author = new AuthorEntity();
        author.name = getActivityAuthorName(activity.author);

        const entity = new Activity({
            id: activity.name,
            subreddit,
            type,
            content: content,
            permalink: activity.permalink,
            author,
            submission
        });

        entity.syncReports(activity, lastKnownStateTimestamp);

        return entity;
    }
}
