import {
    ChildEntity, DataSource
} from "typeorm";
import {FilterCriteria, FilterCriteriaOptions, filterCriteriaTypeIdentifiers} from "./FilterCriteria";
import {TypedActivityState} from "../../interfaces";
import objectHash from "object-hash";

@ChildEntity()
export class ActivityStateFilterCriteria extends FilterCriteria<TypedActivityState> {
    type: string = filterCriteriaTypeIdentifiers.activityState;

    static async getOrInsertCriteria(database: DataSource, config: TypedActivityState) {
        const repo = database.getRepository(this);
        const existing = await repo.findOneBy({hash: objectHash.sha1(config), type: filterCriteriaTypeIdentifiers.activityState});
        if(existing === null) {
            return await repo.save(new this({criteria: config}));
        }
    }

    constructor(data?: FilterCriteriaOptions<TypedActivityState>) {
        super(data);
        if(data !== undefined) {
            this.id = `${this.type}-${this.hash}`;
        }
    }
}
