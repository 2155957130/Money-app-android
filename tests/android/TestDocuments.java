package cn.zhangben.paw;
import android.provider.*;
import android.database.*;
import android.os.*;
import java.io.*;

/** Isolated test-only SAF provider. Never shipped in the production APK. */
public class TestDocuments extends DocumentsProvider {
    private File root(){File root=new File(getContext().getFilesDir(),"qa_documents");root.mkdirs();return root;}
    private File file(String id)throws FileNotFoundException{if("root".equals(id))return root();if(id.contains("/")||id.contains("\\")||id.contains(".."))throw new FileNotFoundException();return new File(root(),id);}
    @Override public boolean onCreate(){return true;}
    private String[] cols(String[] p){return p==null?new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_FLAGS,DocumentsContract.Document.COLUMN_SIZE}:p;}
    private void row(MatrixCursor c,File f,String id){MatrixCursor.RowBuilder r=c.newRow();for(String col:c.getColumnNames()){Object v=null;if(col.equals(DocumentsContract.Document.COLUMN_DOCUMENT_ID))v=id;if(col.equals(DocumentsContract.Document.COLUMN_DISPLAY_NAME))v=f.getName();if(col.equals(DocumentsContract.Document.COLUMN_MIME_TYPE))v=f.isDirectory()?DocumentsContract.Document.MIME_TYPE_DIR:"application/json";if(col.equals(DocumentsContract.Document.COLUMN_FLAGS))v=f.isDirectory()?DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE:DocumentsContract.Document.FLAG_SUPPORTS_WRITE|DocumentsContract.Document.FLAG_SUPPORTS_DELETE;if(col.equals(DocumentsContract.Document.COLUMN_SIZE))v=f.length();r.add(v);}}
    @Override public Cursor queryRoots(String[] p){String[] cols=p==null?new String[]{DocumentsContract.Root.COLUMN_ROOT_ID,DocumentsContract.Root.COLUMN_DOCUMENT_ID,DocumentsContract.Root.COLUMN_TITLE,DocumentsContract.Root.COLUMN_FLAGS}:p;MatrixCursor c=new MatrixCursor(cols);MatrixCursor.RowBuilder r=c.newRow();for(String col:cols){Object v=null;if(col.equals(DocumentsContract.Root.COLUMN_ROOT_ID)||col.equals(DocumentsContract.Root.COLUMN_DOCUMENT_ID))v="root";if(col.equals(DocumentsContract.Root.COLUMN_TITLE))v="Money独立测试文件夹";if(col.equals(DocumentsContract.Root.COLUMN_FLAGS))v=DocumentsContract.Root.FLAG_SUPPORTS_CREATE|DocumentsContract.Root.FLAG_SUPPORTS_IS_CHILD;if(col.equals(DocumentsContract.Root.COLUMN_MIME_TYPES))v="*/*";if(col.equals(DocumentsContract.Root.COLUMN_ICON))v=android.R.drawable.ic_menu_save;r.add(v);}return c;}
    @Override public Cursor queryDocument(String id,String[] p)throws FileNotFoundException{MatrixCursor c=new MatrixCursor(cols(p));row(c,file(id),id);return c;}
    @Override public Cursor queryChildDocuments(String id,String[] p,String sort)throws FileNotFoundException{MatrixCursor c=new MatrixCursor(cols(p));File[] files=file(id).listFiles();if(files!=null)for(File f:files)row(c,f,f.getName());return c;}
    @Override public ParcelFileDescriptor openDocument(String id,String mode,CancellationSignal cancel)throws FileNotFoundException{return ParcelFileDescriptor.open(file(id),ParcelFileDescriptor.parseMode(mode));}
    @Override public String createDocument(String parent,String mime,String name)throws FileNotFoundException{if(!"root".equals(parent))throw new FileNotFoundException();File f=file(name);try{if(!f.exists()&&!f.createNewFile())throw new IOException();return name;}catch(IOException e){throw new FileNotFoundException(e.toString());}}
    @Override public void deleteDocument(String id)throws FileNotFoundException{File f=file(id);if("root".equals(id)||!f.delete())throw new FileNotFoundException();}
    @Override public boolean isChildDocument(String parent,String child){return "root".equals(parent)&&!"root".equals(child);}
}
