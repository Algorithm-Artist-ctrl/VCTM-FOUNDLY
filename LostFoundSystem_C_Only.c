#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <ctype.h>

#define ITEM_FILE "LostFound.dat"
#define USER_FILE "Users.dat"
#define CLAIM_FILE "Claims.dat"

/* =========================
   DATA STRUCTURES
   ========================= */

struct User {
    char username[30];
    char password[30];
    char name[50];
    char contact[20];
};

struct Item {
    int id;
    char name[50];
    char category[30];
    char location[50];
    char date[20];
    char description[100];
    char type[10];          /* Lost / Found */
    char status[20];       /* Active / Claimed / Returned */
    char reporter[30];     /* Username of person who reported it */
    char contact[20];
};

struct Claim {
    int claimId;
    int itemId;
    char claimant[30];
    char proof[150];
    char status[20];       /* Pending / Approved / Rejected */
};

/* =========================
   HELPER FUNCTIONS
   ========================= */

void readLine(char *str, int size)
{
    fgets(str, size, stdin);
    str[strcspn(str, "\n")] = '\0';
}

void clearInputBuffer()
{
    int c;
    while ((c = getchar()) != '\n' && c != EOF) {}
}

void printItem(struct Item item)
{
    printf("\n----------------------------------------\n");
    printf("Item ID      : %d\n", item.id);
    printf("Item Name    : %s\n", item.name);
    printf("Category     : %s\n", item.category);
    printf("Location     : %s\n", item.location);
    printf("Date         : %s\n", item.date);
    printf("Description  : %s\n", item.description);
    printf("Type         : %s\n", item.type);
    printf("Status       : %s\n", item.status);
    printf("Reported By  : %s\n", item.reporter);
    printf("Contact      : %s\n", item.contact);
    printf("----------------------------------------\n");
}

int itemExists(int id)
{
    struct Item item;
    FILE *fp = fopen(ITEM_FILE, "rb");

    if (fp == NULL)
        return 0;

    while (fread(&item, sizeof(item), 1, fp))
    {
        if (item.id == id)
        {
            fclose(fp);
            return 1;
        }
    }

    fclose(fp);
    return 0;
}

int getNextClaimId()
{
    struct Claim claim;
    FILE *fp = fopen(CLAIM_FILE, "rb");
    int maxId = 0;

    if (fp == NULL)
        return 1;

    while (fread(&claim, sizeof(claim), 1, fp))
    {
        if (claim.claimId > maxId)
            maxId = claim.claimId;
    }

    fclose(fp);
    return maxId + 1;
}

/* =========================
   USER REGISTRATION / LOGIN
   ========================= */

void registerUser()
{
    struct User user, existing;
    FILE *fp;

    printf("\n========== USER REGISTRATION ==========\n");

    printf("Enter Username: ");
    readLine(user.username, sizeof(user.username));

    if (strlen(user.username) == 0)
    {
        printf("Username cannot be empty.\n");
        return;
    }

    fp = fopen(USER_FILE, "ab+");
    if (fp == NULL)
    {
        printf("Cannot open user file.\n");
        return;
    }

    rewind(fp);
    while (fread(&existing, sizeof(existing), 1, fp))
    {
        if (strcmp(existing.username, user.username) == 0)
        {
            printf("Username already exists!\n");
            fclose(fp);
            return;
        }
    }

    printf("Enter Password: ");
    readLine(user.password, sizeof(user.password));

    printf("Enter Full Name: ");
    readLine(user.name, sizeof(user.name));

    printf("Enter Contact Number: ");
    readLine(user.contact, sizeof(user.contact));

    fseek(fp, 0, SEEK_END);
    fwrite(&user, sizeof(user), 1, fp);
    fclose(fp);

    printf("\nRegistration successful!\n");
}

int loginUser(char loggedInUser[])
{
    struct User user;
    FILE *fp;
    char username[30];
    char password[30];

    printf("\n========== USER LOGIN ==========\n");

    printf("Enter Username: ");
    readLine(username, sizeof(username));

    printf("Enter Password: ");
    readLine(password, sizeof(password));

    fp = fopen(USER_FILE, "rb");

    if (fp == NULL)
    {
        printf("No registered users found. Please register first.\n");
        return 0;
    }

    while (fread(&user, sizeof(user), 1, fp))
    {
        if (strcmp(user.username, username) == 0 &&
            strcmp(user.password, password) == 0)
        {
            strcpy(loggedInUser, user.username);
            fclose(fp);
            printf("\nLogin successful. Welcome, %s!\n", user.name);
            return 1;
        }
    }

    fclose(fp);
    printf("\nInvalid username or password.\n");
    return 0;
}

/* =========================
   ITEM FUNCTIONS
   ========================= */

void addItem(const char loggedInUser[], const char itemType[])
{
    struct Item item;
    FILE *fp;

    printf("\n========== REPORT %s ITEM ==========\n", itemType);

    printf("Enter Item ID: ");
    scanf("%d", &item.id);
    clearInputBuffer();

    if (itemExists(item.id))
    {
        printf("This Item ID already exists!\n");
        return;
    }

    printf("Enter Item Name: ");
    readLine(item.name, sizeof(item.name));

    printf("Enter Category: ");
    readLine(item.category, sizeof(item.category));

    printf("Enter Location: ");
    readLine(item.location, sizeof(item.location));

    printf("Enter Date: ");
    readLine(item.date, sizeof(item.date));

    printf("Enter Description: ");
    readLine(item.description, sizeof(item.description));

    strcpy(item.type, itemType);
    strcpy(item.status, "Active");
    strcpy(item.reporter, loggedInUser);

    printf("Enter Contact Number: ");
    readLine(item.contact, sizeof(item.contact));

    fp = fopen(ITEM_FILE, "ab");
    if (fp == NULL)
    {
        printf("File cannot be opened!\n");
        return;
    }

    fwrite(&item, sizeof(item), 1, fp);
    fclose(fp);

    printf("\nItem reported successfully!\n");
}

void displayItems()
{
    struct Item item;
    FILE *fp = fopen(ITEM_FILE, "rb");
    int found = 0;

    if (fp == NULL)
    {
        printf("\nNo items found!\n");
        return;
    }

    printf("\n========== ALL ACTIVE ITEMS ==========\n");

    while (fread(&item, sizeof(item), 1, fp))
    {
        if (strcmp(item.status, "Active") == 0)
        {
            printItem(item);
            found = 1;
        }
    }

    fclose(fp);

    if (!found)
        printf("\nNo active items available.\n");
}

void displayItemsByType(const char type[])
{
    struct Item item;
    FILE *fp = fopen(ITEM_FILE, "rb");
    int found = 0;

    if (fp == NULL)
    {
        printf("\nNo item records found.\n");
        return;
    }

    printf("\n========== ALL %s ITEMS ==========\n", type);

    while (fread(&item, sizeof(item), 1, fp))
    {
        if (strcmp(item.type, type) == 0)
        {
            printItem(item);
            found = 1;
        }
    }

    fclose(fp);

    if (!found)
        printf("\nNo %s items found.\n", type);
}

/* =========================
   SEARCH FUNCTIONS
   ========================= */

void searchByName()
{
    struct Item item;
    FILE *fp = fopen(ITEM_FILE, "rb");
    char searchName[50];
    int found = 0;

    if (fp == NULL)
    {
        printf("No item records found.\n");
        return;
    }

    printf("\nEnter Item Name: ");
    readLine(searchName, sizeof(searchName));

    while (fread(&item, sizeof(item), 1, fp))
    {
        if (strcmp(item.name, searchName) == 0 &&
            strcmp(item.status, "Returned") != 0)
        {
            printItem(item);
            found = 1;
        }
    }

    fclose(fp);

    if (!found)
        printf("\nItem not found.\n");
}

void searchByCategory()
{
    struct Item item;
    FILE *fp = fopen(ITEM_FILE, "rb");
    char searchCategory[30];
    int found = 0;

    if (fp == NULL)
    {
        printf("No item records found.\n");
        return;
    }

    printf("\nEnter Category: ");
    readLine(searchCategory, sizeof(searchCategory));

    while (fread(&item, sizeof(item), 1, fp))
    {
        if (strcmp(item.category, searchCategory) == 0 &&
            strcmp(item.status, "Returned") != 0)
        {
            printItem(item);
            found = 1;
        }
    }

    fclose(fp);

    if (!found)
        printf("\nNo item found in this category.\n");
}

void searchByLocation()
{
    struct Item item;
    FILE *fp = fopen(ITEM_FILE, "rb");
    char searchLocation[50];
    int found = 0;

    if (fp == NULL)
    {
        printf("No item records found.\n");
        return;
    }

    printf("\nEnter Location: ");
    readLine(searchLocation, sizeof(searchLocation));

    while (fread(&item, sizeof(item), 1, fp))
    {
        if (strcmp(item.location, searchLocation) == 0 &&
            strcmp(item.status, "Returned") != 0)
        {
            printItem(item);
            found = 1;
        }
    }

    fclose(fp);

    if (!found)
        printf("\nNo item found at this location.\n");
}

void searchMenu()
{
    int choice;

    while (1)
    {
        printf("\n========== SEARCH MENU ==========\n");
        printf("1. Search by Name\n");
        printf("2. Search by Category\n");
        printf("3. Search by Location\n");
        printf("4. Back\n");
        printf("Enter your choice: ");

        scanf("%d", &choice);
        clearInputBuffer();

        switch (choice)
        {
            case 1:
                searchByName();
                break;
            case 2:
                searchByCategory();
                break;
            case 3:
                searchByLocation();
                break;
            case 4:
                return;
            default:
                printf("Invalid choice!\n");
        }
    }
}

/* =========================
   MATCHING
   ========================= */

void matchItems()
{
    struct Item lost, found;
    FILE *fp1, *fp2;
    int match = 0;

    fp1 = fopen(ITEM_FILE, "rb");

    if (fp1 == NULL)
    {
        printf("No item records found.\n");
        return;
    }

    while (fread(&lost, sizeof(lost), 1, fp1))
    {
        if (strcmp(lost.type, "Lost") == 0 &&
            strcmp(lost.status, "Active") == 0)
        {
            fp2 = fopen(ITEM_FILE, "rb");

            if (fp2 == NULL)
                break;

            while (fread(&found, sizeof(found), 1, fp2))
            {
                if (strcmp(found.type, "Found") == 0 &&
                    strcmp(found.status, "Active") == 0)
                {
                    if (strcmp(lost.name, found.name) == 0 &&
                        strcmp(lost.category, found.category) == 0 &&
                        strcmp(lost.location, found.location) == 0)
                    {
                        printf("\n========== MATCH FOUND ==========\n");
                        printf("Lost ID    : %d\n", lost.id);
                        printf("Found ID   : %d\n", found.id);
                        printf("Name       : %s\n", lost.name);
                        printf("Category   : %s\n", lost.category);
                        printf("Location   : %s\n", lost.location);
                        printf("Match Score: 3/3\n");
                        match = 1;
                    }
                }
            }

            fclose(fp2);
        }
    }

    fclose(fp1);

    if (!match)
        printf("\nNo matching item found.\n");
}

/* =========================
   CLAIM FUNCTIONS
   ========================= */

void submitClaim(const char loggedInUser[])
{
    struct Item item;
    struct Claim claim;
    FILE *fp, *cfp;
    int itemId;
    int found = 0;

    printf("\n========== SUBMIT CLAIM ==========\n");
    printf("Enter Found Item ID: ");
    scanf("%d", &itemId);
    clearInputBuffer();

    fp = fopen(ITEM_FILE, "rb");

    if (fp == NULL)
    {
        printf("No item records found.\n");
        return;
    }

    while (fread(&item, sizeof(item), 1, fp))
    {
        if (item.id == itemId)
        {
            found = 1;

            if (strcmp(item.type, "Found") != 0)
            {
                printf("Claims can only be submitted for found items.\n");
                fclose(fp);
                return;
            }

            if (strcmp(item.status, "Active") != 0)
            {
                printf("This item is no longer available for claiming.\n");
                fclose(fp);
                return;
            }

            break;
        }
    }

    fclose(fp);

    if (!found)
    {
        printf("Item ID not found.\n");
        return;
    }

    claim.claimId = getNextClaimId();
    claim.itemId = itemId;
    strcpy(claim.claimant, loggedInUser);
    strcpy(claim.status, "Pending");

    printf("Enter identifying proof/details: ");
    readLine(claim.proof, sizeof(claim.proof));

    cfp = fopen(CLAIM_FILE, "ab");

    if (cfp == NULL)
    {
        printf("Cannot open claim file.\n");
        return;
    }

    fwrite(&claim, sizeof(claim), 1, cfp);
    fclose(cfp);

    printf("\nClaim submitted successfully!\n");
    printf("Claim ID: %d\n", claim.claimId);
}

void viewMyReports(const char loggedInUser[])
{
    struct Item item;
    FILE *fp = fopen(ITEM_FILE, "rb");
    int found = 0;

    if (fp == NULL)
    {
        printf("\nNo item records found.\n");
        return;
    }

    printf("\n========== MY ACTIVE REPORTS ==========\n");

    while (fread(&item, sizeof(item), 1, fp))
    {
        if (strcmp(item.reporter, loggedInUser) == 0 &&
            strcmp(item.status, "Active") == 0)
        {
            printItem(item);
            found = 1;
        }
    }

    fclose(fp);

    if (!found)
        printf("\nYou have no active reports.\n");
}

/* =========================
   UPDATE / DELETE / RETURN
   ========================= */

void updateItem()
{
    struct Item item;
    FILE *fp;
    int id;
    int found = 0;

    fp = fopen(ITEM_FILE, "rb+");

    if (fp == NULL)
    {
        printf("No item records found.\n");
        return;
    }

    printf("Enter Item ID to update: ");
    scanf("%d", &id);
    clearInputBuffer();

    while (fread(&item, sizeof(item), 1, fp))
    {
        if (item.id == id)
        {
            found = 1;

            printf("\nEnter New Item Name: ");
            readLine(item.name, sizeof(item.name));

            printf("Enter New Category: ");
            readLine(item.category, sizeof(item.category));

            printf("Enter New Location: ");
            readLine(item.location, sizeof(item.location));

            printf("Enter New Date: ");
            readLine(item.date, sizeof(item.date));

            printf("Enter New Description: ");
            readLine(item.description, sizeof(item.description));

            fseek(fp, -(long)sizeof(item), SEEK_CUR);
            fwrite(&item, sizeof(item), 1, fp);

            printf("\nItem updated successfully!\n");
            break;
        }
    }

    fclose(fp);

    if (!found)
        printf("\nItem ID not found!\n");
}

void deleteItemById()
{
    struct Item item;
    FILE *fp, *temp;
    int id;
    int found = 0;

    fp = fopen(ITEM_FILE, "rb");

    if (fp == NULL)
    {
        printf("No item records found.\n");
        return;
    }

    temp = fopen("Temp.dat", "wb");

    if (temp == NULL)
    {
        printf("Temporary file cannot be created!\n");
        fclose(fp);
        return;
    }

    printf("Enter Item ID to delete: ");
    scanf("%d", &id);
    clearInputBuffer();

    while (fread(&item, sizeof(item), 1, fp))
    {
        if (item.id == id)
        {
            found = 1;
            continue;
        }

        fwrite(&item, sizeof(item), 1, temp);
    }

    fclose(fp);
    fclose(temp);

    remove(ITEM_FILE);
    rename("Temp.dat", ITEM_FILE);

    if (found)
        printf("\nItem deleted successfully!\n");
    else
        printf("\nItem ID not found!\n");
}

void markReturnedById(int id)
{
    struct Item item;
    FILE *fp = fopen(ITEM_FILE, "rb+");

    if (fp == NULL)
        return;

    while (fread(&item, sizeof(item), 1, fp))
    {
        if (item.id == id)
        {
            strcpy(item.status, "Returned");
            fseek(fp, -(long)sizeof(item), SEEK_CUR);
            fwrite(&item, sizeof(item), 1, fp);
            fclose(fp);
            return;
        }
    }

    fclose(fp);
}

void markReturned()
{
    int id;

    printf("Enter Item ID: ");
    scanf("%d", &id);
    clearInputBuffer();

    if (!itemExists(id))
    {
        printf("Item ID not found.\n");
        return;
    }

    markReturnedById(id);
    printf("\nItem marked as Returned!\n");
}

/* =========================
   ADMIN CLAIM MANAGEMENT
   ========================= */

void viewPendingClaims()
{
    struct Claim claim;
    FILE *fp = fopen(CLAIM_FILE, "rb");
    int found = 0;

    if (fp == NULL)
    {
        printf("\nNo claims found.\n");
        return;
    }

    printf("\n========== PENDING CLAIMS ==========\n");

    while (fread(&claim, sizeof(claim), 1, fp))
    {
        if (strcmp(claim.status, "Pending") == 0)
        {
            printf("\n----------------------------------------\n");
            printf("Claim ID    : %d\n", claim.claimId);
            printf("Item ID     : %d\n", claim.itemId);
            printf("Claimant    : %s\n", claim.claimant);
            printf("Proof       : %s\n", claim.proof);
            printf("Status      : %s\n", claim.status);
            printf("----------------------------------------\n");
            found = 1;
        }
    }

    fclose(fp);

    if (!found)
        printf("\nNo pending claims.\n");
}

void updateClaimStatus(const char newStatus[])
{
    struct Claim claim;
    FILE *fp;
    int claimId;
    int found = 0;
    int itemId = 0;

    fp = fopen(CLAIM_FILE, "rb+");

    if (fp == NULL)
    {
        printf("No claim records found.\n");
        return;
    }

    printf("Enter Claim ID: ");
    scanf("%d", &claimId);
    clearInputBuffer();

    while (fread(&claim, sizeof(claim), 1, fp))
    {
        if (claim.claimId == claimId)
        {
            found = 1;
            itemId = claim.itemId;

            if (strcmp(claim.status, "Pending") != 0)
            {
                printf("This claim has already been processed.\n");
                fclose(fp);
                return;
            }

            strcpy(claim.status, newStatus);

            fseek(fp, -(long)sizeof(claim), SEEK_CUR);
            fwrite(&claim, sizeof(claim), 1, fp);
            break;
        }
    }

    fclose(fp);

    if (!found)
    {
        printf("Claim ID not found.\n");
        return;
    }

    if (strcmp(newStatus, "Approved") == 0)
    {
        markReturnedById(itemId);
        printf("\nClaim approved successfully.\n");
        printf("Item status changed to Returned.\n");
    }
    else
    {
        printf("\nClaim rejected successfully.\n");
    }
}

void viewReturnedItems()
{
    struct Item item;
    FILE *fp = fopen(ITEM_FILE, "rb");
    int found = 0;

    if (fp == NULL)
    {
        printf("\nNo item records found.\n");
        return;
    }

    printf("\n========== RETURNED ITEMS ==========\n");

    while (fread(&item, sizeof(item), 1, fp))
    {
        if (strcmp(item.status, "Returned") == 0)
        {
            printItem(item);
            found = 1;
        }
    }

    fclose(fp);

    if (!found)
        printf("\nNo returned items found.\n");
}

/* =========================
   ADMIN FUNCTIONS
   ========================= */

void viewAllUsers()
{
    struct User user;
    FILE *fp = fopen(USER_FILE, "rb");
    int found = 0;

    if (fp == NULL)
    {
        printf("\nNo users registered.\n");
        return;
    }

    printf("\n========== ALL REGISTERED USERS ==========\n");

    while (fread(&user, sizeof(user), 1, fp))
    {
        printf("\n----------------------------------------\n");
        printf("Username : %s\n", user.username);
        printf("Name     : %s\n", user.name);
        printf("Contact  : %s\n", user.contact);
        printf("----------------------------------------\n");
        found = 1;
    }

    fclose(fp);

    if (!found)
        printf("\nNo users found.\n");
}

/* =========================
   USER MENU
   ========================= */

void userMenu(const char loggedInUser[])
{
    int choice;

    while (1)
    {
        printf("\n========================================\n");
        printf("              USER MENU\n");
        printf("========================================\n");
        printf("Logged in as: %s\n\n", loggedInUser);

        printf("1. Report Lost Item\n");
        printf("2. Report Found Item\n");
        printf("3. View Available Items\n");
        printf("4. Search Item\n");
        printf("5. Match Lost and Found Items\n");
        printf("6. Submit Claim\n");
        printf("7. View My Active Reports\n");
        printf("8. Logout\n");

        printf("\nEnter your choice: ");
        scanf("%d", &choice);
        clearInputBuffer();

        switch (choice)
        {
            case 1:
                addItem(loggedInUser, "Lost");
                break;

            case 2:
                addItem(loggedInUser, "Found");
                break;

            case 3:
                displayItems();
                break;

            case 4:
                searchMenu();
                break;

            case 5:
                matchItems();
                break;

            case 6:
                submitClaim(loggedInUser);
                break;

            case 7:
                viewMyReports(loggedInUser);
                break;

            case 8:
                printf("\nLogged out successfully.\n");
                return;

            default:
                printf("\nInvalid choice! Please try again.\n");
        }
    }
}

/* =========================
   ADMIN MENU
   ========================= */

void adminMenu()
{
    int choice;

    while (1)
    {
        printf("\n========================================\n");
        printf("             ADMIN PANEL\n");
        printf("========================================\n");

        printf("1. View All Registered Users\n");
        printf("2. View All Lost Items\n");
        printf("3. View All Found Items\n");
        printf("4. Delete Incorrect/Old Record\n");
        printf("5. View Pending Claim Requests\n");
        printf("6. Approve Claim\n");
        printf("7. Reject Claim\n");
        printf("8. Update Item Information\n");
        printf("9. Manage Verification / Return Status\n");
        printf("10. View Returned Items\n");
        printf("11. Logout\n");

        printf("\nEnter your choice: ");
        scanf("%d", &choice);
        clearInputBuffer();

        switch (choice)
        {
            case 1:
                viewAllUsers();
                break;

            case 2:
                displayItemsByType("Lost");
                break;

            case 3:
                displayItemsByType("Found");
                break;

            case 4:
                deleteItemById();
                break;

            case 5:
                viewPendingClaims();
                break;

            case 6:
                updateClaimStatus("Approved");
                break;

            case 7:
                updateClaimStatus("Rejected");
                break;

            case 8:
                updateItem();
                break;

            case 9:
                markReturned();
                break;

            case 10:
                viewReturnedItems();
                break;

            case 11:
                printf("\nAdmin logged out successfully.\n");
                return;

            default:
                printf("\nInvalid choice! Please try again.\n");
        }
    }
}

/* =========================
   MAIN MENU
   ========================= */

int main()
{
    int choice;
    char loggedInUser[30];

    while (1)
    {
        printf("\n========================================\n");
        printf("         LOST AND FOUND SYSTEM\n");
        printf("========================================\n");
        printf("1. User Registration\n");
        printf("2. User Login\n");
        printf("3. Admin Login\n");
        printf("4. Exit\n");

        printf("\nEnter your choice: ");
        scanf("%d", &choice);
        clearInputBuffer();

        switch (choice)
        {
            case 1:
                registerUser();
                break;

            case 2:
                if (loginUser(loggedInUser))
                    userMenu(loggedInUser);
                break;

            case 3:
            {
                char username[30];
                char password[30];

                printf("\n========== ADMIN LOGIN ==========\n");
                printf("Username: ");
                readLine(username, sizeof(username));

                printf("Password: ");
                readLine(password, sizeof(password));

                /*
                   Default admin credentials:
                   Username: admin
                   Password: admin123
                */

                if (strcmp(username, "admin") == 0 &&
                    strcmp(password, "admin123") == 0)
                {
                    printf("\nAdmin login successful.\n");
                    adminMenu();
                }
                else
                {
                    printf("\nInvalid admin username or password.\n");
                }
                break;
            }

            case 4:
                printf("\nThank you for using Lost and Found System!\n");
                return 0;

            default:
                printf("\nInvalid choice! Please try again.\n");
        }
    }

    return 0;
}
