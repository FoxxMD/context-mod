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
    getGuests: () => Promise<GuestEntityData[]>
    addGuest: (val: GuestEntityData | GuestEntityData[]) => Promise<GuestEntityData[]>
    removeGuestById: (val: string | string[]) => Promise<GuestEntityData[]>
    removeGuestByUser: (val: string | string[]) => Promise<GuestEntityData[]>
    removeGuests: () => Promise<GuestEntityData[]>
}
