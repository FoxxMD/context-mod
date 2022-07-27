import { Dayjs } from "dayjs"
import {AuthorEntity} from "../AuthorEntity";

export interface Guest {
    id: string
    name: string
    expiresAt?: number
}

export interface GuestAll {
    name: string
    expiresAt?: number
    subreddits: string[]
}


export interface GuestEntityData {
    expiresAt?: Dayjs
    author: AuthorEntity
}

export interface HasGuests {
    getGuests: () => GuestEntityData[]
    addGuest: (val: GuestEntityData | GuestEntityData[]) => GuestEntityData[]
    removeGuestById: (val: string | string[]) => GuestEntityData[]
    removeGuestByUser: (val: string | string[]) => GuestEntityData[]
    removeGuests: () => GuestEntityData[]
}
