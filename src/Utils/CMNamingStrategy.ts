// originally from https://github.com/tonivj5/typeorm-naming-strategies/blob/master/src/snake-naming.strategy.ts
// package does not yet support typeorm 4

// Credits to @recurrence
// https://gist.github.com/recurrence/b6a4cb04a8ddf42eda4e4be520921bd2

import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';
import { snakeCase, titleCase, camelCase } from 'typeorm/util/StringUtils';

export class CMNamingStrategy
    extends DefaultNamingStrategy
    implements NamingStrategyInterface {
    tableName(className: string, customName: string): string {
        return customName ?? className;
    }

    columnName(
        propertyName: string,
        customName: string,
        embeddedPrefixes: string[],
    ): string {
        return (
            camelCase(embeddedPrefixes.concat('').join('_')) +
            (customName ? customName : camelCase(propertyName))
        );
    }

    relationName(propertyName: string): string {
        return camelCase(propertyName);
    }

    joinColumnName(relationName: string, referencedColumnName: string): string {
        return camelCase(relationName + '_' + referencedColumnName);
    }

    joinTableName(
        firstTableName: string,
        secondTableName: string,
        firstPropertyName: string,
        secondPropertyName: string,
    ): string {
        return camelCase(
            firstTableName +
            '_' +
            firstPropertyName.replace(/\./gi, '_') +
            '_' +
            secondTableName,
        );
    }

    joinTableColumnName(
        tableName: string,
        propertyName: string,
        columnName?: string,
    ): string {
        return camelCase(
            tableName + '_' + (columnName ? columnName : propertyName),
        );
    }

    classTableInheritanceParentColumnName(
        parentTableName: any,
        parentTableIdPropertyName: any,
    ): string {
        return camelCase(parentTableName + '_' + parentTableIdPropertyName);
    }

    eagerJoinRelationAlias(alias: string, propertyPath: string): string {
        return alias + '__' + propertyPath.replace('.', '_');
    }
}
