package ae.latinem.attendance;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LsTrackerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
