const {DataSource} = require("typeorm");
const {CMNamingStrategy} = require("./src/Utils/CMNamingStrategy");

const MyDataSource = new DataSource({
    type: "sqljs",
    autoSave: true,
    location: "database.sqlite",
    logging: "all",
    entities: [
        "src/Common/Entities/**/*.js"
    ],
    migrations: [
        "src/Common/Migrations/Database/**/*.js"
    ],
    namingStrategy: new CMNamingStrategy(),
})

exports.sqljs = MyDataSource;
