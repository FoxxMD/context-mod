import {
    ChildEntity, DataSource
} from "typeorm";
import {FilterCriteria, FilterCriteriaOptions, filterCriteriaTypeIdentifiers} from "./FilterCriteria";
import objectHash from "object-hash";
import {AuthorCriteria} from "../../interfaces";

@ChildEntity()
export class AuthorFilterCriteria extends FilterCriteria<AuthorCriteria> {
    type: string = filterCriteriaTypeIdentifiers.author;

    static async getOrInsertCriteria(database: DataSource, config: AuthorCriteria) {
        const repo = database.getRepository(this);
        const existing = await repo.findOneBy({hash: objectHash.sha1(config), type: filterCriteriaTypeIdentifiers.author});
        if(existing === null) {
            return await repo.save(new this({criteria: config}));
        }
    }

    constructor(data?: FilterCriteriaOptions<AuthorCriteria>) {
        super(data);
        if(data !== undefined) {
            this.id = `${this.type}-${this.hash}`;
        }
    }
}
