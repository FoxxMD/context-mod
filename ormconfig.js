const {DataSource} = require("typeorm");
const {SnakeNamingStrategy} = require("./src/Utils/SnakeCaseNamingStrategy");

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
    //namingStrategy: new SnakeNamingStrategy(),
})

exports.sqljs = MyDataSource;
